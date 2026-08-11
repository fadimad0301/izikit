# Phase 5 — Accompagnement Complet tier — Design

## Context

Phase 4 shipped the "Accompagnement Simple" tier (5000 FCFA): a per-procedure paywall
unlocking a read-only document checklist via the existing Bictorys/Order/webhook flow.
The landing page (`frontend/src/components/landing/Pricing.tsx`) already advertises a
second tier, "Accompagnement Complet" (20 000 FCFA), promising:

- "Tout le Simple, en illimité"
- "Suivi et upload de documents"
- "Analyse IA des points à améliorer"

This phase builds that tier: a per-procedure premium purchase (not a global unlock) that
adds document upload/tracking per checklist item and AI-generated CV weak-point analysis
scoped to the purchased procedure.

This also closes a real security gap surfaced during design: `frontend/src/app/api/upload/route.ts`
delivers files via Cloudinary's public, unauthenticated `secure_url` — documented as a known
limitation acceptable for avatars, but not for the passport scans / transcripts this tier
will accept. Procedure documents use Cloudinary's `authenticated` delivery type with signed,
short-lived URLs instead.

**Confirmed decisions (do not re-litigate):**
1. Complet is purchased **per procedure** (like Simple), not a global "unlock everything" purchase.
2. Documents attach **one file per checklist item**, not a freeform document bucket.
3. AI analysis targets **the generated CV** (`CvProfile.generatedCv`), contextualized to the
   purchased procedure — not document-completeness scoring, not document content analysis.
4. **Upgrade path exists**: a user who already owns Simple for a procedure can upgrade to
   Complet for the price differential (15 000 FCFA), not the full 20 000 FCFA again.
5. Pricing is **global and fixed** across all procedures (5000 / 20 000 / 15 000 FCFA) — not
   configurable per procedure.
6. Cloudinary's public-URL delivery gap is fixed **now**, scoped to procedure documents only —
   signed, short-TTL URLs generated on demand, never stored.

**Protected files (do not touch):** same list as Phase 4 — `frontend/src/lib/server/{auth,crypto,
logger,redis,rate-limit-store,slug,zod-helpers}.ts`, `webhook/handler.ts`,
`payments/circuit-breaker.ts`, `oauth/google.ts` (+ routes), `outbox/dispatcher.ts`,
`admin/audit.ts`, `middleware/{index,require-admin,require-org-role}.ts`,
`observability/request-context.ts`, `instrumentation.ts`, `lib/api.ts`.

`frontend/src/app/api/webhooks/bictorys/route.ts` is a thin wrapper over the protected
`webhook/handler.ts` factory and remains fair game (same as Phase 4 Task 3).
`frontend/src/lib/server/upload/cloudinary-client.ts` is not protected — extended, not replaced.

---

## Data model

### `ProcedureAccess` — add a `tier` field

```prisma
model ProcedureAccess {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  procedureId String
  procedure   Procedure @relation(fields: [procedureId], references: [id], onDelete: Restrict)
  orderId     String    @unique
  order       Order     @relation(fields: [orderId], references: [id], onDelete: Restrict)
  tier        String    @default("SIMPLE") // "SIMPLE" | "COMPLET"
  grantedAt   DateTime  @default(now())

  @@unique([userId, procedureId])
  @@index([userId])
}
```

Existing Phase 4 rows default to `"SIMPLE"` — no data migration needed beyond the schema
default. An upgrade **updates the existing row in place** (same `id`, `tier` flips to
`"COMPLET"`, `orderId` repointed to the upgrade order) rather than creating a second row —
the `@@unique([userId, procedureId])` constraint already assumes at most one access row per
user+procedure, and this phase keeps that invariant.

### `Procedure.checklist` — items gain a stable `id`

Current shape: `{ title: string; description?: string }[]`.
New shape: `{ id: string; title: string; description?: string }[]`.

The `id` is a short kebab-case slug (e.g. `"passeport-valide"`), assigned once in the seed
data and never derived from `title` at read time — so a later copy edit to `title` can't
silently orphan uploaded documents. `frontend/scripts/seed-procedures.ts` is updated to add
an `id` to every checklist item across all 5 existing procedures.

A shared type/schema (new file `frontend/src/lib/server/procedures/checklist.ts`) exports
`ChecklistItem` (`{ id: string; title: string; description?: string }`) — imported by the
seed script and by the procedure detail route, so the shape isn't duplicated ad hoc.

### New model: `ProcedureDocument`

```prisma
model ProcedureDocument {
  id                 String    @id @default(cuid())
  userId             String
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  procedureId        String
  procedure          Procedure @relation(fields: [procedureId], references: [id], onDelete: Restrict)
  checklistItemId    String
  cloudinaryPublicId String    @unique
  resourceType       String    // Cloudinary resource_type ("image" | "raw" | "video") — needed to mint a valid signed URL later
  filename           String
  mimeType           String
  sizeBytes          Int
  uploadedAt         DateTime  @default(now())

  @@unique([userId, procedureId, checklistItemId])
  @@index([userId, procedureId])
}
```

Re-uploading for the same `(userId, procedureId, checklistItemId)` overwrites the existing
row and the existing Cloudinary asset (deterministic `public_id`, `overwrite: true` — no
orphaned Cloudinary assets, no explicit delete step needed).

### Pricing constants — new file, single source of truth

`frontend/src/lib/server/procedures/pricing.ts` (not protected):

```typescript
export const PROCEDURE_SIMPLE_PRICE_FCFA = 5000;
export const PROCEDURE_COMPLET_PRICE_FCFA = 20000;
export const PROCEDURE_UPGRADE_PRICE_FCFA = 15000; // Simple -> Complet differential
```

`GET /api/procedures/[slug]` includes `completPriceFcfa` and `upgradePriceFcfa` in its
response, unconditionally (regardless of the caller's current tier — cheap constants, no
reason to branch), so the frontend never hardcodes these numbers — it reads them from the
API, same principle as the existing `priceFcfa` (Simple) field. The frontend decides which
of the two matters (`upgradePriceFcfa` only makes sense to show when `tier === 'SIMPLE'`). This also resolves the Phase 4
deferred finding I3 ("`'SIMPLE'` magic string with no shared constant") by giving both tier
literals and their prices one canonical home.

---

## Webhook logic (`app/api/webhooks/bictorys/route.ts`)

Extends the `onPaid` access-grant block added in Phase 4 (and hardened in that phase's final
review). Still runs inside the existing Serializable transaction, still never throws (skip +
`log.warn` on any failure so a bad `procedureId` or an underpaid order can never roll back
the `PAID` status update or strand a real payment):

```
meta = parse(order.metadata)  // { tier: 'SIMPLE' | 'COMPLET', procedureId }
if order.userId && meta valid:
  procedure = tx.procedure.findUnique(meta.procedureId)
  if !procedure: log.warn('unknown procedureId'); skip

  existingAccess = tx.procedureAccess.findUnique({userId, procedureId: procedure.id})

  if meta.tier === 'SIMPLE':
    if order.currency !== 'XOF' || order.amount < PROCEDURE_SIMPLE_PRICE_FCFA:
      log.warn('underpaid SIMPLE'); skip
    else:
      upsert ProcedureAccess: create tier=SIMPLE; update: {} (never downgrades an existing COMPLET)

  else if meta.tier === 'COMPLET':
    required = existingAccess?.tier === 'SIMPLE'
      ? PROCEDURE_UPGRADE_PRICE_FCFA   // 15 000 — upgrade path
      : PROCEDURE_COMPLET_PRICE_FCFA   // 20 000 — direct purchase
    if order.currency !== 'XOF' || order.amount < required:
      log.warn('underpaid COMPLET'); skip
    else:
      upsert ProcedureAccess: create tier=COMPLET; update: { tier: 'COMPLET', orderId: order.id }

  else:
    log.warn('unknown tier'); skip
```

The `PROCEDURE_SIMPLE_PRICE_FCFA` check replaces Phase 4's `procedure.priceFcfa` comparison
one-for-one (same value today, 5000). Going forward, **all three price fields returned by
`GET /api/procedures` and `GET /api/procedures/[slug]` (Simple/Complet/upgrade) are sourced
from the constants file, not from the `Procedure.priceFcfa` DB column** — pricing is global
per the confirmed decisions above, so there is exactly one source of truth instead of two
that happen to agree today. `Procedure.priceFcfa` stays in the schema (dropping a column is
out of scope for this phase and the seed script still writes it) but nothing in this phase's
routes reads it anymore.

---

## Document upload + signed delivery

### `cloudinary-client.ts` — additive, existing exports unchanged

Two new functions alongside the existing `uploadBuffer` (used by the public, unrelated
`/api/upload` route — untouched):

- `uploadAuthenticatedBuffer(publicId, body, contentType): Promise<UploadResult & { resourceType: string }>`
  — mirrors `uploadBuffer`, sets `type: 'authenticated'` and `overwrite: true` in the
  Cloudinary options, and threads `resource_type` from the response into the return value.
- `getSignedDeliveryUrl(publicId, resourceType, ttlSeconds): string` — builds a signed,
  time-limited URL via Cloudinary's SDK (`cloudinary.utils.private_download_url` or
  `cloudinary.url(..., { sign_url: true, type: 'authenticated', ... })`), never persisted.

### `POST /api/procedures/[slug]/documents`

`verifyCsrf` → `requireAuth` → look up access, 403 unless `tier === 'COMPLET'` → parse
`multipart/form-data` (`checklistItemId` + `file`) → 400 if `checklistItemId` doesn't match a
real item in this procedure's checklist → reuse the existing size-cap / MIME-allowlist /
magic-byte-sniff checks from `/api/upload` (same limits, same `verifyMagicBytes` /
`sanitizeFilename` helpers) → `uploadAuthenticatedBuffer` with `public_id =
procedures/{userId}/{procedureId}/{checklistItemId}` → upsert `ProcedureDocument`.

### `GET /api/procedures/[slug]/documents/[itemId]/url`

`requireAuth` → look up the `ProcedureDocument` row scoped to `(auth.user.sub, procedure.id,
itemId)` → 404 if none (never 403 — matches the existing 404-not-403 convention for
non-owned resources) → 403 if tier isn't `COMPLET` → `getSignedDeliveryUrl(...)` with a short
TTL (5 minutes) → `{ url, expiresAt }`. This is the only way to read a document's bytes; the
raw Cloudinary URL is never returned anywhere else.

### `GET /api/procedures/[slug]` — extended response

For `tier === 'COMPLET'`, each checklist item gains upload status:
`{ id, title, description?, uploaded: boolean, filename?: string }` (no URL — the signed-URL
route above is the only path to the file itself, keeping the TTL meaningfully short and
every access auditable via that route's own request log).

---

## AI weak-point analysis

### `AiProvider` — new method

`frontend/src/lib/server/ai/provider.ts` (not protected) gains:

```typescript
export interface CvAnalysisInput {
  generatedCv: GeneratedCv;
  procedure: { name: string; country: string; field?: string };
}

export interface CvAnalysis {
  points: string[]; // French-language improvement suggestions
}

export interface AiProvider {
  name: string;
  generateCv(input: CvGenerationInput): Promise<GeneratedCv>;
  analyzeCv(input: CvAnalysisInput): Promise<CvAnalysis>; // new
}
```

Implemented in `claude.ts` alongside the existing `generateCv`, with its own prompt that
contextualizes suggestions to the target procedure's country/field.

### `POST /api/procedures/[slug]/analyze`

`verifyCsrf` → `requireAuth` → 403 unless `tier === 'COMPLET'` → look up `CvProfile` for the
user; 400 `CV_NOT_GENERATED` if `generatedCv` is null → rate-limit check (new bucket on the
existing `generation-limiter.ts` pattern, 20/day/user — a cost guard, not a product limit;
Complet itself is marketed as "illimité") → `ai.analyzeCv({ generatedCv, procedure })` →
`{ points: string[] }`.

No persistence — every call is a fresh generation. This matches "illimité": the user clicks
"Analyser mon CV" whenever they want an update, with no cache to invalidate or explain.

---

## UI

### `/procedures/[slug]` (existing page, extended)

- **No access:** two CTAs, "Débloquer Simple (5000 FCFA)" and "Débloquer Complet (20 000
  FCFA)" — amounts read from the API response, never hardcoded.
- **`tier === 'SIMPLE'`:** checklist stays read-only (unchanged from Phase 4) plus a banner,
  "Passer à Complet (+15 000 FCFA)".
- **`tier === 'COMPLET'`:** each checklist item renders a new `ChecklistItemUpload`
  component (`frontend/src/components/procedures/ChecklistItemUpload.tsx`) — file picker,
  upload status (missing / uploaded + filename), and a "Voir le document" action that calls
  the signed-URL route and opens the result in a new tab. An "Analyser mon CV" button at the
  top of the page calls `/analyze` and renders the returned points in a simple bulleted
  panel, with a loading state and a clear message (linking to `/cv`) if the API returns
  `CV_NOT_GENERATED`.

### Purchase / upgrade

Reuses the existing `POST /api/orders` + Bictorys redirect flow unchanged — only the
`metadata.tier` and `amount` sent differ per button clicked, both read from the procedure
detail API response.

### `Pricing.tsx` (landing page)

No structural change — its Complet-tier copy is already accurate and its CTA already routes
to `/signup`; the choice between Simple/Complet happens on the procedure detail page, same
pattern as Phase 4.

---

## Testing

- Webhook: both COMPLET price thresholds (direct purchase vs. upgrade), never-downgrades
  invariant, unknown-procedure and underpaid-amount skip paths (mocked `$transaction`, same
  pattern as Phase 4's webhook tests).
- Upload route: reused size/MIME/magic-byte guards, `type: 'authenticated'` config, 403 for
  non-Complet tier, upsert-overwrites-on-reupload behavior.
- Signed-URL route: 404 for a document that doesn't belong to the caller, 403 for
  non-Complet tier, TTL passed through correctly.
- Analyze route: 400 `CV_NOT_GENERATED`, 403 for non-Complet tier, rate-limit bucket
  behavior (mirrors `generation-limiter.test.ts`).
- No real Cloudinary integration test — the client is mocked, same as `/api/upload` today.

**Manual verification** (mirrors Phase 4's Task 11 pattern): local smoke test with a real
file upload, confirming the signed URL actually expires after its TTL, and confirming an
upgrade purchase updates the existing `ProcedureAccess` row's tier without creating a
duplicate.

---

## Explicitly out of scope (deferred, consistent with Phase 4's YAGNI calls)

- Deleting an already-uploaded document (re-upload replaces it — no delete UI/endpoint).
- Refund / downgrade from Complet back to Simple.
- A duplicate-purchase guard (same family as Phase 4's deferred I2 — general to the
  Order/webhook flow, not specific to this tier).
- Per-procedure custom pricing (confirmed as global/fixed for this phase).
- Analysis result persistence/history.
