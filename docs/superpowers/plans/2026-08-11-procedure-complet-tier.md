# Phase 5 — Accompagnement Complet Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Accompagnement Complet" tier (20 000 FCFA, per procedure): checklist-item document upload with signed Cloudinary delivery, an upgrade path from Simple, and AI weak-point analysis of the student's CV contextualized to the purchased procedure.

**Architecture:** Extends Phase 4's `ProcedureAccess`/webhook/checklist flow with a `tier` field (no new purchase model), a new `ProcedureDocument` model for per-checklist-item uploads (Cloudinary `authenticated` delivery, signed URLs minted on demand), and a second `AiProvider` method (`analyzeCv`) reusing the Phase 3 `ai/` module's provider abstraction.

**Tech Stack:** Next.js 16 App Router route handlers, Prisma 5, Cloudinary SDK v2 (`private_download_url` for expiring signed URLs), `@anthropic-ai/sdk` via the existing `ai/` module, Vitest + `vitest-mock-extended`.

## Global Constraints

- Every Route Handler: `export const runtime = 'nodejs'`.
- Mutating routes: `verifyCsrf(req)` before `requireAuth`, matching every existing route in this codebase.
- Non-owned resources: 404, never 403 (existing convention — see `GET /api/orders/[id]`, `GET /api/procedures/[slug]`).
- FCFA amounts are integers, no decimals.
- Pricing is global and fixed: Simple = 5000 FCFA, Complet = 20 000 FCFA, Simple→Complet upgrade = 15 000 FCFA — sourced from `frontend/src/lib/server/procedures/pricing.ts`, never hardcoded elsewhere, never read from `Procedure.priceFcfa` in application routes (only the seed script still writes that column).
- Complet is purchased **per procedure**, not a global unlock. An upgrade updates the existing `ProcedureAccess` row in place (`tier` flips to `COMPLET`) — it never creates a second row for the same `(userId, procedureId)`.
- `ProcedureAccess` upserts never downgrade an existing `COMPLET` tier back to `SIMPLE`.
- Procedure documents use Cloudinary's `authenticated` delivery type. The only way to read a document's bytes is the signed-URL route (`GET /api/procedures/[slug]/documents/[itemId]/url`), TTL 300 seconds, never persisted.
- The webhook (`onPaid`) never throws on a bad/underpaid/unknown grant — it logs a warning and skips, so a real payment's `PAID` status update is never rolled back (Phase 4 invariant, unchanged).
- Files NOT to modify: `frontend/src/lib/server/{auth,crypto,logger,redis,rate-limit-store,slug,zod-helpers}.ts`, `webhook/handler.ts`, `payments/circuit-breaker.ts`, `oauth/google.ts` (+ its routes), `outbox/dispatcher.ts`, `admin/audit.ts`, `middleware/{index,require-admin,require-org-role}.ts`, `observability/request-context.ts`, `instrumentation.ts`, `lib/api.ts`. `frontend/src/app/api/webhooks/bictorys/route.ts` and `frontend/src/lib/server/upload/cloudinary-client.ts` are NOT protected (thin wrapper / additive extension, respectively) — they are directly in scope for this plan.
- Every new/modified route stays within the JSON-only contract: routes return `NextResponse.json(...)`, no DOM concerns server-side.
- Copy is real French, tutoiement, matching the rest of the app.

---

### Task 1: Prisma schema — `ProcedureAccess.tier` + `ProcedureDocument` model

**Files:**
- Modify: `frontend/prisma/schema.prisma`
- Create: migration under `frontend/prisma/migrations/` (name via CLI, see Step 3)

**Interfaces:**
- Produces: `ProcedureAccess.tier: string` (`"SIMPLE" | "COMPLET"`, default `"SIMPLE"`), new model `ProcedureDocument` with fields `id, userId, procedureId, checklistItemId, cloudinaryPublicId, resourceType, filename, mimeType, sizeBytes, uploadedAt`, unique on `[userId, procedureId, checklistItemId]` (Prisma-generated compound key name `userId_procedureId_checklistItemId`), unique on `cloudinaryPublicId`. Every later task that touches `ProcedureAccess` or uploads a document depends on these exact field names.

- [ ] **Step 1: Add `tier` to `ProcedureAccess` and the new `ProcedureDocument` model**

Open `frontend/prisma/schema.prisma`. Find the existing `ProcedureAccess` model (it currently ends with `@@index([userId])`) and add a `tier` field, then add the new `ProcedureDocument` model right after it:

```prisma
model ProcedureAccess {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  procedureId String
  procedure   Procedure @relation(fields: [procedureId], references: [id], onDelete: Restrict)
  orderId     String    @unique
  order       Order     @relation(fields: [orderId], references: [id], onDelete: Restrict)
  tier        String    @default("SIMPLE") // "SIMPLE" | "COMPLET" — Phase 5
  grantedAt   DateTime  @default(now())

  @@unique([userId, procedureId])
  @@index([userId])
}

// Phase 5 — one uploaded file per (user, procedure, checklist item). Cloudinary
// stores the asset with `type: 'authenticated'` (never publicly reachable);
// `resourceType` is required to mint a valid signed delivery URL later (see
// lib/server/upload/cloudinary-client.ts's getSignedDeliveryUrl). A re-upload
// for the same triple overwrites this row and the same Cloudinary asset
// (deterministic public_id) — no delete endpoint needed.
model ProcedureDocument {
  id                 String    @id @default(cuid())
  userId             String
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  procedureId        String
  procedure          Procedure @relation(fields: [procedureId], references: [id], onDelete: Restrict)
  checklistItemId    String
  cloudinaryPublicId String    @unique
  resourceType       String
  filename           String
  mimeType           String
  sizeBytes          Int
  uploadedAt         DateTime  @default(now())

  @@unique([userId, procedureId, checklistItemId])
  @@index([userId, procedureId])
}
```

Also add the reverse relations on `User` and `Procedure`. Find `procedureAccess ProcedureAccess[]` on the `User` model and add a line right after it:

```prisma
  procedureDocuments ProcedureDocument[]
```

Find `access ProcedureAccess[]` on the `Procedure` model and add a line right after it:

```prisma
  documents ProcedureDocument[]
```

- [ ] **Step 2: Kill any stale dev server before migrating (Windows file-lock)**

Prisma Client regeneration fails silently if a `next dev` process holds a lock on `query_engine-windows.dll.node`. Check for and stop any running dev server before continuing:

```bash
cd frontend
pnpm exec prisma generate --help > /dev/null 2>&1 || true
```

If a later step's `prisma generate` hangs or errors with an EPERM/file-lock message, stop any `node`/`next` process running the dev server first, then retry.

- [ ] **Step 3: Run the migration**

```bash
cd frontend
pnpm db:migrate:dev -- --name doxi_complet_tier
```

Expected: Prisma creates a new folder under `frontend/prisma/migrations/`, applies it to the dev database, and regenerates the Prisma Client. Confirm the migration file contains an `ALTER TABLE "ProcedureAccess" ADD COLUMN "tier"` statement and a `CREATE TABLE "ProcedureDocument"` statement.

- [ ] **Step 4: Verify the generated Prisma Client**

```bash
cd frontend
pnpm exec tsc --noEmit
```

Expected: no errors. This confirms `prisma.procedureDocument` and `ProcedureAccess.tier` are now visible to TypeScript (the deep-mocked `prismaMock` test util derives its shape from the same generated client, so every later task's test file gets `prismaMock.procedureDocument.*` for free once this step passes).

- [ ] **Step 5: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(db): add ProcedureAccess.tier + ProcedureDocument model (Phase 5)"
```

---

### Task 2: Shared modules — checklist item type + pricing constants

**Files:**
- Create: `frontend/src/lib/server/procedures/checklist.ts`
- Create: `frontend/src/lib/server/procedures/checklist.test.ts`
- Create: `frontend/src/lib/server/procedures/pricing.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `ChecklistItem` type (`{ id: string; title: string; description?: string }`) and `checklistItemSchema` (Zod), imported by Task 3 (seed), Task 6 (procedure routes), Task 7 (upload route). `PROCEDURE_SIMPLE_PRICE_FCFA`, `PROCEDURE_COMPLET_PRICE_FCFA`, `PROCEDURE_UPGRADE_PRICE_FCFA` (all `number`), imported by Task 5 (webhook) and Task 6 (procedure routes).

- [ ] **Step 1: Write the checklist item schema**

Create `frontend/src/lib/server/procedures/checklist.ts`:

```typescript
// Doxi Phase 5 — shared shape for one Procedure.checklist entry. The `id`
// is a stable slug assigned once in scripts/seed-procedures.ts and never
// derived from `title` at read time, so a later copy edit can't silently
// orphan a ProcedureDocument that references it via checklistItemId.
import { z } from 'zod';

export const checklistItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSchema = z.array(checklistItemSchema);
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/lib/server/procedures/checklist.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checklistItemSchema, checklistSchema } from './checklist';

describe('checklistItemSchema', () => {
  it('accepts an item with id, title, and description', () => {
    const result = checklistItemSchema.safeParse({
      id: 'passeport-valide',
      title: 'Passeport en cours de validité',
      description: 'Valide au moins 6 mois après le départ.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an item without description', () => {
    const result = checklistItemSchema.safeParse({ id: 'cv-a-jour', title: 'CV à jour' });
    expect(result.success).toBe(true);
  });

  it('rejects an item missing id', () => {
    const result = checklistItemSchema.safeParse({ title: 'CV à jour' });
    expect(result.success).toBe(false);
  });
});

describe('checklistSchema', () => {
  it('accepts an array of valid items', () => {
    const result = checklistSchema.safeParse([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', description: 'desc' },
    ]);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter frontend exec vitest run src/lib/server/procedures/checklist.test.ts
```

Expected: PASS (this schema is simple enough that TDD's "write failing first" step is immediate — write the file and test together, then run).

- [ ] **Step 4: Write the pricing constants**

Create `frontend/src/lib/server/procedures/pricing.ts`:

```typescript
// Doxi Phase 5 — single source of truth for procedure pricing. Global and
// fixed across all procedures (confirmed design decision — not configurable
// per procedure). GET /api/procedures and GET /api/procedures/[slug] read
// these instead of Procedure.priceFcfa; the webhook's onPaid handler
// enforces payment amounts against these same constants.
export const PROCEDURE_SIMPLE_PRICE_FCFA = 5000;
export const PROCEDURE_COMPLET_PRICE_FCFA = 20000;
export const PROCEDURE_UPGRADE_PRICE_FCFA = 15000; // Simple -> Complet differential
```

No test needed — three exported constants, nothing to assert beyond what TypeScript already checks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/server/procedures/checklist.ts frontend/src/lib/server/procedures/checklist.test.ts frontend/src/lib/server/procedures/pricing.ts
git commit -m "feat(procedures): add checklist item schema + pricing constants (Phase 5)"
```

---

### Task 3: Seed script — stable checklist item ids

**Files:**
- Modify: `frontend/scripts/seed-procedures.ts`
- Modify: `frontend/scripts/seed-procedures.test.ts`

**Interfaces:**
- Consumes: `ChecklistItem` type from `frontend/src/lib/server/procedures/checklist.ts` (Task 2).
- Produces: every seeded procedure's `checklist` array now has stable `id`s that Task 7 (upload route) and Task 6 (procedure routes) validate against.

- [ ] **Step 1: Update the local `ChecklistItem` interface to import the shared type**

In `frontend/scripts/seed-procedures.ts`, replace the local interface definition:

```typescript
interface ChecklistItem {
  title: string;
  description?: string;
}
```

with an import of the shared type:

```typescript
import type { ChecklistItem } from '../src/lib/server/procedures/checklist';
```

(Add this import alongside the existing `import { pathToFileURL } from 'node:url';` and `import { PrismaClient, type Prisma } from '@prisma/client';` lines.)

- [ ] **Step 2: Add a stable `id` to every checklist item**

Replace the entire `PROCEDURES` array with this version — every item now carries an `id` (kebab-case slug, unique within its own procedure's array):

```typescript
const PROCEDURES: ProcedureSeed[] = [
  {
    slug: 'campus-france',
    name: 'Campus France',
    country: 'France',
    tagline: 'La procédure obligatoire pour candidater aux universités françaises.',
    priceFcfa: 5000,
    checklist: [
      {
        id: 'passeport-valide',
        title: 'Passeport en cours de validité',
        description: 'Valide au moins 6 mois après la date de départ prévue.',
      },
      {
        id: 'releves-notes',
        title: 'Relevés de notes des 2 ou 3 dernières années',
        description: 'Traduits en français si l’original est dans une autre langue.',
      },
      {
        id: 'diplomes-attestation',
        title: 'Diplômes obtenus (ou attestation de scolarité en cours)',
      },
      {
        id: 'lettre-motivation',
        title: 'Lettre de motivation',
        description: 'Adaptée à chaque formation demandée.',
      },
      { id: 'cv-a-jour', title: 'CV à jour' },
      {
        id: 'justificatif-ressources',
        title: 'Justificatif de ressources financières',
        description: 'Preuve de capacité à financer au moins la première année.',
      },
      {
        id: 'certificat-francais',
        title: 'Certificat de français (TCF/TEF) si la formation l’exige',
      },
    ],
  },
  {
    slug: 'chevening',
    name: 'Chevening',
    country: 'Royaume-Uni',
    field: 'Master',
    tagline: 'Bourse britannique entièrement financée pour un Master d’un an.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'lettres-recommandation',
        title: '3 lettres de recommandation',
        description:
          'D’employeurs ou d’enseignants, soumises directement en ligne par les référents.',
      },
      {
        id: 'essais-candidature',
        title: 'Essais de candidature Chevening',
        description:
          '4 essais courts sur le leadership, le réseau, les études et les objectifs de carrière.',
      },
      { id: 'cv-a-jour', title: 'CV à jour' },
      { id: 'diplomes-releves', title: 'Diplômes et relevés de notes' },
      {
        id: 'preuve-experience',
        title: 'Preuve de 2 ans d’expérience professionnelle minimum',
      },
      {
        id: 'offres-admission',
        title: '3 offres d’admission inconditionnelles à des universités britanniques éligibles',
        description:
          'À obtenir avant la date limite Chevening, séparément de la candidature à la bourse.',
      },
    ],
  },
  {
    slug: 'bourses-canada',
    name: 'Bourses Canada',
    country: 'Canada',
    tagline: 'Programmes de bourses d’études supérieures pour étudiants internationaux.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'lettre-admission',
        title: 'Lettre d’admission ou de pré-admission d’un établissement canadien reconnu',
      },
      {
        id: 'releves-notes-officiels',
        title: 'Relevés de notes officiels',
        description: 'Traduits en français ou en anglais.',
      },
      { id: 'lettre-motivation', title: 'Lettre de motivation' },
      { id: 'lettres-recommandation', title: '2 à 3 lettres de recommandation académiques' },
      {
        id: 'preuve-linguistique',
        title: 'Preuve de compétence linguistique (IELTS/TEF)',
        description: 'Selon la langue d’enseignement du programme visé.',
      },
      {
        id: 'caq-preuve-fonds',
        title: 'Certificat d’acceptation du Québec (CAQ) ou preuve de fonds',
        description: 'Selon la province et le type de bourse.',
      },
    ],
  },
  {
    slug: 'amci-maroc',
    name: 'AMCI Maroc',
    country: 'Maroc',
    tagline: 'Bourses de l’Agence Marocaine de Coopération Internationale.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      { id: 'copie-diplome', title: 'Copie légalisée du baccalauréat ou du dernier diplôme obtenu' },
      { id: 'releves-notes-legalises', title: 'Relevés de notes légalisés des 2 dernières années' },
      {
        id: 'certificat-medical',
        title: 'Certificat médical d’aptitude',
        description: 'Délivré par un médecin agréé.',
      },
      { id: 'acte-naissance', title: 'Extrait d’acte de naissance' },
      { id: 'photos-identite', title: 'Photos d’identité récentes' },
      {
        id: 'dossier-amci',
        title: 'Dossier de candidature AMCI complété',
        description: 'Déposé auprès de l’ambassade du Maroc ou du service culturel compétent.',
      },
    ],
  },
  {
    slug: 'ytb-turkiye',
    name: 'YTB Türkiye',
    country: 'Turquie',
    tagline: 'Bourses Türkiye pour étudiants internationaux, tous niveaux confondus.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'diplome-releves',
        title: 'Diplôme le plus récent et relevés de notes',
        description: 'Traduits et si besoin apostillés.',
      },
      { id: 'lettre-motivation', title: 'Lettre de motivation' },
      {
        id: 'lettres-recommandation',
        title: 'Lettres de recommandation',
        description: 'Nombre variable selon le niveau d’études visé.',
      },
      {
        id: 'certificat-medical',
        title: 'Certificat médical attestant l’absence de maladie contagieuse',
      },
      { id: 'photos-identite', title: 'Photos d’identité récentes' },
      {
        id: 'candidature-en-ligne',
        title: 'Candidature en ligne complétée sur le portail Türkiye Scholarships',
      },
    ],
  },
];
```

Keep the rest of the file (the `ProcedureSeed` interface, `SeedDeps`, `main()`, and the CLI entrypoint guard) exactly as-is — only the `PROCEDURES` array content and the `ChecklistItem` import change.

- [ ] **Step 3: Extend the seed test to assert every item has a stable id**

In `frontend/scripts/seed-procedures.test.ts`, add one test after the existing `'stores a non-empty checklist array for every procedure'` test:

```typescript
  it('gives every checklist item a non-empty, unique-within-procedure id', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    for (const call of prismaMock.procedure.upsert.mock.calls) {
      const createData = call[0]?.create as { checklist: { id: string }[] };
      const ids = createData.checklist.map((item) => item.id);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter frontend exec vitest run scripts/seed-procedures.test.ts
```

Expected: all tests PASS (4 total after this addition).

- [ ] **Step 5: Re-seed the dev database**

```bash
pnpm --filter frontend exec tsx scripts/seed-procedures.ts
```

Expected: 5 lines of `✓ <slug> — <name>` output (the upsert-by-slug means existing rows get their `checklist` column overwritten with the new id-bearing version — no duplication).

- [ ] **Step 6: Commit**

```bash
git add frontend/scripts/seed-procedures.ts frontend/scripts/seed-procedures.test.ts
git commit -m "feat(seed): add stable checklist item ids to the procedure catalog (Phase 5)"
```

---

### Task 4: Cloudinary client — authenticated upload + signed delivery URL

**Files:**
- Modify: `frontend/src/lib/server/upload/cloudinary-client.ts`
- Modify: `frontend/src/test-utils/cloudinary-mock.ts`
- Create: `frontend/src/lib/server/upload/cloudinary-client.test.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing lazy-init `configureOnce()` pattern in the same file).
- Produces: `uploadAuthenticatedBuffer(publicId, body, contentType): Promise<UploadResult & { resourceType: string }>` and `getSignedDeliveryUrl(publicId, resourceType, expiresAtUnixSeconds): string`, consumed by Task 7 (upload route) and Task 8 (signed-url route) respectively.

- [ ] **Step 1: Add the two new exports to `cloudinary-client.ts`**

Open `frontend/src/lib/server/upload/cloudinary-client.ts`. The existing `UploadResult` interface, `configureOnce()`, and `uploadBuffer()` stay completely unchanged — this step only adds new code after `uploadBuffer()` and before the `__resetCloudinarySingleton` test helper:

```typescript
/**
 * Upload a buffer with Cloudinary's `authenticated` delivery type — the
 * asset is NOT reachable via the plain public `/upload/` URL path at all.
 * The only way to read it back is `getSignedDeliveryUrl()` below. Used for
 * procedure documents (passport scans, transcripts) — never for the public
 * `/api/upload` route, which keeps using `uploadBuffer()` unchanged.
 *
 * `overwrite: true` + a deterministic `publicId` (built by the caller as
 * `procedures/{userId}/{procedureId}/{checklistItemId}`) means a re-upload
 * for the same checklist item replaces the same Cloudinary asset in place —
 * no orphaned assets, no explicit delete step.
 */
export async function uploadAuthenticatedBuffer(
  publicId: string,
  body: Buffer,
  contentType: string,
): Promise<UploadResult & { resourceType: string }> {
  configureOnce();

  const options: UploadApiOptions = {
    public_id: publicId,
    resource_type: 'auto',
    type: 'authenticated',
    overwrite: true,
  };
  if (_preset) options.upload_preset = _preset;
  if (contentType) options.metadata = `mime=${contentType}`;

  const res = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, response) => {
      if (err) return reject(err);
      if (!response) return reject(new Error('Cloudinary upload returned no response'));
      resolve(response);
    });
    stream.end(body);
  });

  return {
    publicId: res.public_id,
    secureUrl: res.secure_url,
    bytes: typeof res.bytes === 'number' ? res.bytes : body.length,
    resourceType: res.resource_type,
  };
}

/**
 * Mint a short-lived, signed download URL for an `authenticated`-type
 * asset. Cloudinary's `private_download_url` genuinely enforces
 * `expires_at` server-side on its `/download` endpoint (unlike a plain
 * `sign_url: true` delivery URL, which has no built-in expiry) — this is
 * the mechanism, not a cosmetic wrapper. Never persist the result; callers
 * mint a fresh one on every request (see
 * app/api/procedures/[slug]/documents/[itemId]/url/route.ts).
 */
export function getSignedDeliveryUrl(
  publicId: string,
  resourceType: string,
  expiresAtUnixSeconds: number,
): string {
  configureOnce();
  return cloudinary.utils.private_download_url(publicId, '', {
    resource_type: resourceType as 'image' | 'video' | 'raw',
    type: 'authenticated',
    expires_at: expiresAtUnixSeconds,
    attachment: false,
  });
}
```

- [ ] **Step 2: Extend the Cloudinary test mock util**

Open `frontend/src/test-utils/cloudinary-mock.ts`. Extend `MockCloudinaryOptions`, `MockUploadResult`, `MockCloudinaryClient`, and `mockCloudinaryClient()` to also cover the two new functions:

```typescript
export interface MockCloudinaryOptions {
  /**
   * Override for `uploadBuffer`. If omitted, returns a happy
   * `{ publicId, secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/<id>', bytes }`.
   * Throw to simulate upload failure.
   */
  onUpload?: Mock;
  /** Override for `uploadAuthenticatedBuffer`. Same default shape as `onUpload`, plus `resourceType: 'image'`. */
  onUploadAuthenticated?: Mock;
  /** Override for `getSignedDeliveryUrl`. Defaults to a deterministic fake signed URL string. */
  onGetSignedDeliveryUrl?: Mock;
}

export interface MockUploadResult {
  publicId: string;
  secureUrl: string;
  bytes: number;
}

export interface MockCloudinaryClient {
  uploadBuffer: (publicId: string, body: Buffer) => Promise<MockUploadResult>;
  uploadAuthenticatedBuffer: (
    publicId: string,
    body: Buffer,
  ) => Promise<MockUploadResult & { resourceType: string }>;
  getSignedDeliveryUrl: (publicId: string, resourceType: string, expiresAt: number) => string;
}

export function mockCloudinaryClient(opts: MockCloudinaryOptions = {}): MockCloudinaryClient {
  return {
    uploadBuffer: vi.fn(async (publicId: string, body: Buffer) => {
      if (opts.onUpload) return (await opts.onUpload(publicId, body)) as MockUploadResult;
      return {
        publicId,
        secureUrl: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}`,
        bytes: body.length,
      };
    }),
    uploadAuthenticatedBuffer: vi.fn(async (publicId: string, body: Buffer) => {
      if (opts.onUploadAuthenticated) {
        return (await opts.onUploadAuthenticated(publicId, body)) as MockUploadResult & {
          resourceType: string;
        };
      }
      return {
        publicId,
        secureUrl: `https://res.cloudinary.com/test-cloud/authenticated/upload/${publicId}`,
        bytes: body.length,
        resourceType: 'image',
      };
    }),
    getSignedDeliveryUrl: vi.fn((publicId: string, resourceType: string, expiresAt: number) => {
      if (opts.onGetSignedDeliveryUrl) {
        return opts.onGetSignedDeliveryUrl(publicId, resourceType, expiresAt) as string;
      }
      return `https://api.cloudinary.com/v1_1/test-cloud/${resourceType}/download?public_id=${publicId}&expires_at=${expiresAt}&signature=test-sig`;
    }),
  };
}
```

- [ ] **Step 3: Write the failing test**

Create `frontend/src/lib/server/upload/cloudinary-client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const uploadStreamMock = vi.fn();
const privateDownloadUrlMock = vi.fn(() => 'https://api.cloudinary.com/v1_1/test/image/download?signature=x');

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: (
        options: Record<string, unknown>,
        cb: (err: unknown, res: unknown) => void,
      ) => {
        uploadStreamMock(options);
        return {
          end: (_body: Buffer) => {
            cb(null, {
              public_id: options.public_id,
              secure_url: `https://res.cloudinary.com/test/authenticated/upload/${options.public_id}`,
              bytes: 4,
              resource_type: 'image',
            });
          },
        };
      },
    },
    utils: {
      private_download_url: privateDownloadUrlMock,
    },
  },
}));

beforeEach(() => {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
  uploadStreamMock.mockClear();
  privateDownloadUrlMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('uploadAuthenticatedBuffer', () => {
  it('uploads with type: authenticated and overwrite: true', async () => {
    const { uploadAuthenticatedBuffer } = await import('./cloudinary-client');
    const result = await uploadAuthenticatedBuffer('procedures/u1/p1/item1', Buffer.from('abcd'), 'image/jpeg');
    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: 'procedures/u1/p1/item1',
        type: 'authenticated',
        overwrite: true,
      }),
    );
    expect(result.resourceType).toBe('image');
    expect(result.publicId).toBe('procedures/u1/p1/item1');
  });
});

describe('getSignedDeliveryUrl', () => {
  it('calls Cloudinary private_download_url with type authenticated and the given expiry', () => {
    const { getSignedDeliveryUrl } = require('./cloudinary-client') as typeof import('./cloudinary-client');
    const url = getSignedDeliveryUrl('procedures/u1/p1/item1', 'image', 1234567890);
    expect(privateDownloadUrlMock).toHaveBeenCalledWith(
      'procedures/u1/p1/item1',
      '',
      expect.objectContaining({ type: 'authenticated', resource_type: 'image', expires_at: 1234567890 }),
    );
    expect(url).toContain('cloudinary.com');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails, then passes**

```bash
pnpm --filter frontend exec vitest run src/lib/server/upload/cloudinary-client.test.ts
```

Expected before Step 1's code exists: FAIL (`uploadAuthenticatedBuffer`/`getSignedDeliveryUrl` not exported). After Step 1: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/server/upload/cloudinary-client.ts frontend/src/test-utils/cloudinary-mock.ts frontend/src/lib/server/upload/cloudinary-client.test.ts
git commit -m "feat(upload): add authenticated upload + signed delivery URL to Cloudinary client (Phase 5)"
```

---

### Task 5: Webhook — Complet tier + upgrade pricing

**Files:**
- Modify: `frontend/src/app/api/webhooks/bictorys/route.ts`
- Modify: `frontend/src/app/api/webhooks/bictorys/route.test.ts`

**Interfaces:**
- Consumes: `PROCEDURE_SIMPLE_PRICE_FCFA`, `PROCEDURE_COMPLET_PRICE_FCFA`, `PROCEDURE_UPGRADE_PRICE_FCFA` from `frontend/src/lib/server/procedures/pricing.ts` (Task 2).
- Produces: `ProcedureAccess.tier` correctly set to `'COMPLET'` for both a direct Complet purchase and a Simple→Complet upgrade, consumed by every later task that reads `tier`.

- [ ] **Step 1: Replace the access-grant block in `onPaid`**

Open `frontend/src/app/api/webhooks/bictorys/route.ts`. Add the pricing import near the top, alongside the existing imports:

```typescript
import {
  PROCEDURE_SIMPLE_PRICE_FCFA,
  PROCEDURE_COMPLET_PRICE_FCFA,
  PROCEDURE_UPGRADE_PRICE_FCFA,
} from '@/lib/server/procedures/pricing';
```

Replace the entire `if (order.userId) { const meta = OrderMetadata.safeParse(order.metadata); ... }` block (the Phase 4 access-grant logic, currently checking `meta.data.tier === 'SIMPLE'` and `procedure.priceFcfa`) with:

```typescript
    if (order.userId) {
      const meta = OrderMetadata.safeParse(order.metadata);
      if (meta.success && meta.data.procedureId) {
        const procedure = await tx.procedure.findUnique({
          where: { id: meta.data.procedureId },
          select: { id: true },
        });

        if (!procedure) {
          log.warn('procedure access not granted: unknown procedureId', {
            orderId: order.id,
            procedureId: meta.data.procedureId,
          });
        } else if (meta.data.tier === 'SIMPLE') {
          if (order.currency !== 'XOF' || order.amount < PROCEDURE_SIMPLE_PRICE_FCFA) {
            log.warn('procedure access not granted: payment does not cover Simple price', {
              orderId: order.id,
              procedureId: procedure.id,
              amount: order.amount,
              currency: order.currency,
            });
          } else {
            await tx.procedureAccess.upsert({
              where: {
                userId_procedureId: { userId: order.userId, procedureId: procedure.id },
              },
              create: {
                userId: order.userId,
                procedureId: procedure.id,
                orderId: order.id,
                tier: 'SIMPLE',
              },
              update: {}, // never downgrades an existing COMPLET
            });
          }
        } else if (meta.data.tier === 'COMPLET') {
          const existingAccess = await tx.procedureAccess.findUnique({
            where: {
              userId_procedureId: { userId: order.userId, procedureId: procedure.id },
            },
            select: { tier: true },
          });
          const required =
            existingAccess?.tier === 'SIMPLE'
              ? PROCEDURE_UPGRADE_PRICE_FCFA
              : PROCEDURE_COMPLET_PRICE_FCFA;

          if (order.currency !== 'XOF' || order.amount < required) {
            log.warn('procedure access not granted: payment does not cover Complet price', {
              orderId: order.id,
              procedureId: procedure.id,
              amount: order.amount,
              currency: order.currency,
              required,
            });
          } else {
            await tx.procedureAccess.upsert({
              where: {
                userId_procedureId: { userId: order.userId, procedureId: procedure.id },
              },
              create: {
                userId: order.userId,
                procedureId: procedure.id,
                orderId: order.id,
                tier: 'COMPLET',
              },
              update: { tier: 'COMPLET', orderId: order.id },
            });
          }
        } else {
          log.warn('procedure access not granted: unknown tier', {
            orderId: order.id,
            tier: meta.data.tier,
          });
        }
      }
    }
```

- [ ] **Step 2: Extend the webhook test mocks**

Open `frontend/src/app/api/webhooks/bictorys/route.test.ts`. Add a `procedureAccessFindUnique` mock alongside the existing ones:

```typescript
const procedureAccessFindUnique = vi.fn();
```

Add it to the `$transaction` mock's `procedureAccess` object:

```typescript
const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: { findUnique, create, update },
    order: { findFirst: orderFindFirst, update: orderUpdate },
    outboxEvent: { create: outboxCreate },
    procedureAccess: { upsert: procedureAccessUpsert, findUnique: procedureAccessFindUnique },
    procedure: { findUnique: procedureFindUnique },
  }),
);
```

Add it to `beforeEach`'s reset block:

```typescript
  procedureAccessFindUnique.mockReset();
```

Update the two existing tests that mock `procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1', priceFcfa: 5000 })` — the route no longer selects `priceFcfa`, so trim the mock to match (extra fields are harmless but the exact assertion below needs the `create` call to include `tier: 'SIMPLE'`). In the test `'onPaid creates ProcedureAccess for a SIMPLE-tier order with procedureId (Phase 4)'`, change:

```typescript
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1', priceFcfa: 5000 });
```

to:

```typescript
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1' });
```

and change the assertion:

```typescript
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o1' },
      update: {},
    });
```

to:

```typescript
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o1', tier: 'SIMPLE' },
      update: {},
    });
```

In the two other tests that mock `procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1', priceFcfa: 5000 })` (`'onPaid does not grant access when the paid amount is below the procedure price'`), change to `procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1' })` — the assertion (`procedureAccessUpsert` not called) is unaffected.

- [ ] **Step 3: Add the new Complet/upgrade tests**

Append these tests inside the existing `describe('POST /api/webhooks/bictorys', ...)` block, after the last existing test:

```typescript
  it('onPaid grants COMPLET directly when no prior access exists and amount covers 20000 (Phase 5)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o6',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 20000,
      currency: 'XOF',
      metadata: { tier: 'COMPLET', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob6' });
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1' });
    procedureAccessFindUnique.mockResolvedValueOnce(null);
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o6', tier: 'COMPLET' },
      update: { tier: 'COMPLET', orderId: 'o6' },
    });
  });

  it('onPaid does not grant a direct COMPLET purchase paid at only 15000 (Phase 5)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o7',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 15000,
      currency: 'XOF',
      metadata: { tier: 'COMPLET', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob7' });
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1' });
    procedureAccessFindUnique.mockResolvedValueOnce(null); // no prior SIMPLE access
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).not.toHaveBeenCalled();
  });

  it('onPaid grants a COMPLET upgrade at the 15000 differential when prior SIMPLE access exists (Phase 5)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o8',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 15000,
      currency: 'XOF',
      metadata: { tier: 'COMPLET', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob8' });
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1' });
    procedureAccessFindUnique.mockResolvedValueOnce({ tier: 'SIMPLE' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o8', tier: 'COMPLET' },
      update: { tier: 'COMPLET', orderId: 'o8' },
    });
  });

  it('onPaid never downgrades an existing COMPLET access on a replayed/duplicate SIMPLE order (Phase 5)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o9',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob9' });
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o9', tier: 'SIMPLE' },
      update: {}, // empty update — a real COMPLET row would be left untouched
    });
  });
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts
```

Expected: all tests PASS (13 total: 9 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/webhooks/bictorys/route.ts frontend/src/app/api/webhooks/bictorys/route.test.ts
git commit -m "feat(webhook): grant Complet tier + Simple->Complet upgrade pricing (Phase 5)"
```

---

### Task 6: `GET /api/procedures` + `GET /api/procedures/[slug]` — Complet fields

**Files:**
- Modify: `frontend/src/app/api/procedures/route.ts`
- Modify: `frontend/src/app/api/procedures/route.test.ts`
- Modify: `frontend/src/app/api/procedures/[slug]/route.ts`
- Modify: `frontend/src/app/api/procedures/[slug]/route.test.ts`

**Interfaces:**
- Consumes: pricing constants (Task 2), `ChecklistItem` type (Task 2), `ProcedureAccess.tier` (Task 1).
- Produces: `GET /api/procedures` items now include `priceFcfa` sourced from the constant (unchanged value, new source). `GET /api/procedures/[slug]` response gains `completPriceFcfa: number`, `upgradePriceFcfa: number`, `tier: 'SIMPLE' | 'COMPLET' | null`; when `tier === 'COMPLET'`, each checklist item gains `uploaded: boolean` and `filename?: string`. Consumed by Task 13 (procedure detail page).

- [ ] **Step 1: Update `GET /api/procedures` to source price from the constant**

Open `frontend/src/app/api/procedures/route.ts`. Remove `priceFcfa: true` from `PROCEDURE_LIST_SELECT`, add the pricing import, and map the constant onto each row:

```typescript
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { PROCEDURE_SIMPLE_PRICE_FCFA } from '@/lib/server/procedures/pricing';

const PROCEDURE_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
} satisfies Prisma.ProcedureSelect;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const procedures = await prisma.procedure.findMany({
      select: PROCEDURE_LIST_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    const withPrice = procedures.map((p) => ({ ...p, priceFcfa: PROCEDURE_SIMPLE_PRICE_FCFA }));

    return NextResponse.json(withPrice, {
      status: 200,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
```

- [ ] **Step 2: Update the list route's test**

Open `frontend/src/app/api/procedures/route.test.ts`. Remove `priceFcfa: 5000` from the mocked `prismaMock.procedure.findMany` resolved value's DB row (the DB no longer supplies it to this route) but keep it in the expected response body (it's now added by the route from the constant). Replace the first test's body:

```typescript
  it('returns the procedure list without leaking checklist content', async () => {
    prismaMock.procedure.findMany.mockResolvedValue([
      {
        id: 'proc_1',
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tagline: 'Candidature aux universités françaises.',
      },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'proc_1',
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tagline: 'Candidature aux universités françaises.',
        priceFcfa: 5000,
      },
    ]);
    expect(body[0]).not.toHaveProperty('checklist');

    expect(prismaMock.procedure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ checklist: true, priceFcfa: true }),
      }),
    );
  });
```

Leave the second test (`'returns an empty array when no procedures exist'`) unchanged.

- [ ] **Step 3: Update `GET /api/procedures/[slug]`**

Replace the entire contents of `frontend/src/app/api/procedures/[slug]/route.ts`:

```typescript
// Doxi Phase 4/5 — GET /api/procedures/[slug]. optionalAuth so both guests
// and authenticated callers can view a procedure's name/tagline/price;
// `checklist` (the content being sold) is only included when the caller
// holds a ProcedureAccess row for it. Phase 5 adds `tier`, the Complet/
// upgrade prices, and per-item upload status when tier is COMPLET.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { optionalAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import type { ChecklistItem } from '@/lib/server/procedures/checklist';
import {
  PROCEDURE_SIMPLE_PRICE_FCFA,
  PROCEDURE_COMPLET_PRICE_FCFA,
  PROCEDURE_UPGRADE_PRICE_FCFA,
} from '@/lib/server/procedures/pricing';

const PROCEDURE_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  checklist: true,
} satisfies Prisma.ProcedureSelect;

type Tier = 'SIMPLE' | 'COMPLET';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { slug } = await ctx.params;

    const procedure = await prisma.procedure.findUnique({
      where: { slug },
      select: PROCEDURE_DETAIL_SELECT,
    });
    if (!procedure) {
      return NextResponse.json(
        { error: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const auth = await optionalAuth(req.headers.get('authorization'));
    let tier: Tier | null = null;
    if (auth) {
      const access = await prisma.procedureAccess.findUnique({
        where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
        select: { tier: true },
      });
      tier = (access?.tier as Tier | undefined) ?? null;
    }
    const hasAccess = tier !== null;

    let uploadedByItem = new Map<string, string>();
    if (auth && tier === 'COMPLET') {
      const docs = await prisma.procedureDocument.findMany({
        where: { userId: auth.user.sub, procedureId: procedure.id },
        select: { checklistItemId: true, filename: true },
      });
      uploadedByItem = new Map(docs.map((d) => [d.checklistItemId, d.filename]));
    }

    const { checklist, ...publicFields } = procedure;
    const checklistItems = checklist as unknown as ChecklistItem[];
    const checklistResponse = hasAccess
      ? checklistItems.map((item) =>
          tier === 'COMPLET'
            ? {
                ...item,
                uploaded: uploadedByItem.has(item.id),
                filename: uploadedByItem.get(item.id),
              }
            : item,
        )
      : undefined;

    return NextResponse.json(
      {
        ...publicFields,
        priceFcfa: PROCEDURE_SIMPLE_PRICE_FCFA,
        completPriceFcfa: PROCEDURE_COMPLET_PRICE_FCFA,
        upgradePriceFcfa: PROCEDURE_UPGRADE_PRICE_FCFA,
        hasAccess,
        tier,
        ...(checklistResponse ? { checklist: checklistResponse } : {}),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Extend `GET /api/procedures/[slug]`'s test**

Open `frontend/src/app/api/procedures/[slug]/route.test.ts`. Update `PROCEDURE_ROW` to drop `priceFcfa` (no longer selected) and give the checklist item a stable `id`:

```typescript
const PROCEDURE_ROW = {
  id: 'proc_1',
  slug: 'campus-france',
  name: 'Campus France',
  country: 'France',
  field: null,
  tagline: 'Candidature aux universités françaises.',
  checklist: [{ id: 'passeport-valide', title: 'Passeport en cours de validité' }],
};
```

Update the third test's assertion (the caller-holds-access case) — `procedureAccess.findUnique` now selects `tier`, and `checklist` should equal the id-bearing item, `tier` should be `'SIMPLE'`:

```typescript
  it('includes checklist and hasAccess:true when the caller holds ProcedureAccess', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.hasAccess).toBe(true);
    expect(body.tier).toBe('SIMPLE');
    expect(body.checklist).toEqual([{ id: 'passeport-valide', title: 'Passeport en cours de validité' }]);
    expect(prismaMock.procedureAccess.findUnique).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'user-1', procedureId: 'proc_1' } },
      select: { tier: true },
    });
  });
```

Add two new tests after it:

```typescript
  it('includes completPriceFcfa and upgradePriceFcfa in every response', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.completPriceFcfa).toBe(20000);
    expect(body.upgradePriceFcfa).toBe(15000);
    expect(body.priceFcfa).toBe(5000);
  });

  it('marks per-item upload status when tier is COMPLET', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.findMany.mockResolvedValue([
      { checklistItemId: 'passeport-valide', filename: 'passeport.jpg' },
    ] as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.tier).toBe('COMPLET');
    expect(body.checklist).toEqual([
      { id: 'passeport-valide', title: 'Passeport en cours de validité', uploaded: true, filename: 'passeport.jpg' },
    ]);
  });
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter frontend exec vitest run src/app/api/procedures
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/procedures
git commit -m "feat(api): expose Complet tier + upgrade pricing on procedure routes (Phase 5)"
```

---

### Task 7: `POST /api/procedures/[slug]/documents` — checklist item upload

**Files:**
- Create: `frontend/src/app/api/procedures/[slug]/documents/route.ts`
- Create: `frontend/src/app/api/procedures/[slug]/documents/route.test.ts`

**Interfaces:**
- Consumes: `uploadAuthenticatedBuffer` (Task 4), `ChecklistItem` type (Task 2), `sanitizeFilename`/`verifyMagicBytes` (existing, from `/api/upload`).
- Produces: `ProcedureDocument` rows, consumed by Task 6's response (already wired) and Task 8's signed-URL lookup.

- [ ] **Step 1: Write the route**

Create `frontend/src/app/api/procedures/[slug]/documents/route.ts`:

```typescript
// Doxi Phase 5 — POST /api/procedures/[slug]/documents. Complet-tier only:
// uploads one file per checklist item. Stored with Cloudinary's
// `authenticated` delivery type (never publicly reachable) — the only way
// to read it back is GET .../documents/[itemId]/url (signed, 5-minute TTL).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import {
  StorageNotConfiguredError,
  uploadAuthenticatedBuffer,
} from '@/lib/server/upload/cloudinary-client';
import { sanitizeFilename } from '@/lib/server/upload/sanitize-filename';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';
import type { ChecklistItem } from '@/lib/server/procedures/checklist';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { slug } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { slug },
      select: { id: true, checklist: true },
    });
    if (!procedure) {
      return NextResponse.json(
        { code: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const access = await prisma.procedureAccess.findUnique({
      where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
      select: { tier: true },
    });
    if (access?.tier !== 'COMPLET') {
      return NextResponse.json(
        { code: 'COMPLET_REQUIRED', message: 'L’offre Complet est requise pour cette action.' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const allowedMime = (process.env.UPLOAD_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const maxBytes = Number.parseInt(process.env.UPLOAD_MAX_BYTES ?? '10485760', 10);

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const form = await req.formData();
    const checklistItemId = form.get('checklistItemId');
    if (typeof checklistItemId !== 'string' || checklistItemId.length === 0) {
      return NextResponse.json(
        { code: 'MISSING_CHECKLIST_ITEM_ID', message: 'checklistItemId is required' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    const checklistItems = procedure.checklist as unknown as ChecklistItem[];
    if (!checklistItems.some((item) => item.id === checklistItemId)) {
      return NextResponse.json(
        { code: 'UNKNOWN_CHECKLIST_ITEM', message: 'Item de checklist inconnu.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: 'UPLOAD_MISSING_FILE', message: 'file field is required' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (file.size > maxBytes) {
      return NextResponse.json(
        { code: 'FILE_TOO_LARGE', message: `Max ${maxBytes} bytes` },
        { status: 413, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (!allowedMime.includes(file.type)) {
      return NextResponse.json(
        { code: 'INVALID_MIME', message: `MIME ${file.type} not allowed` },
        { status: 415, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { code: 'MAGIC_BYTE_MISMATCH', message: 'File bytes do not match declared MIME' },
        { status: 415, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const storedFilename = sanitizeFilename(file.name);
    const publicId = `procedures/${auth.user.sub}/${procedure.id}/${checklistItemId}`;

    let uploaded;
    try {
      uploaded = await uploadAuthenticatedBuffer(publicId, buf, file.type);
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
          { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      return NextResponse.json(
        { code: 'UPLOAD_FAILED', message: 'Storage write failed' },
        { status: 502, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const row = await prisma.procedureDocument.upsert({
      where: {
        userId_procedureId_checklistItemId: {
          userId: auth.user.sub,
          procedureId: procedure.id,
          checklistItemId,
        },
      },
      create: {
        userId: auth.user.sub,
        procedureId: procedure.id,
        checklistItemId,
        cloudinaryPublicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        filename: storedFilename,
        mimeType: file.type,
        sizeBytes: uploaded.bytes,
      },
      update: {
        cloudinaryPublicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        filename: storedFilename,
        mimeType: file.type,
        sizeBytes: uploaded.bytes,
      },
      select: { checklistItemId: true, filename: true },
    });

    return NextResponse.json(
      { checklistItemId: row.checklistItemId, filename: row.filename, uploaded: true },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 2: Write the test**

Create `frontend/src/app/api/procedures/[slug]/documents/route.test.ts`:

```typescript
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mockCloudinaryClient } from '@/test-utils/cloudinary-mock';

const cl = mockCloudinaryClient();

vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  uploadAuthenticatedBuffer: vi.fn((id: string, body: Buffer) => cl.uploadAuthenticatedBuffer(id, body)),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {
    constructor() {
      super('Storage not configured');
      this.name = 'StorageNotConfiguredError';
    }
  },
}));

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

beforeEach(() => {
  vi.stubEnv('UPLOAD_ALLOWED_MIME', 'image/jpeg,image/png,image/webp');
  vi.stubEnv('UPLOAD_MAX_BYTES', '10485760');
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const PROCEDURE_ROW = {
  id: 'proc_1',
  checklist: [{ id: 'passeport-valide', title: 'Passeport en cours de validité' }],
};

function makeReq(fields: { checklistItemId?: string; file?: File | null } = {}): Request {
  const fd = new FormData();
  if (fields.checklistItemId !== undefined) fd.append('checklistItemId', fields.checklistItemId);
  if (fields.file) fd.append('file', fields.file);
  return new Request(new URL('http://localhost/api/procedures/campus-france/documents'), {
    method: 'POST',
    body: fd,
    headers: { 'x-csrf-token': 'test-csrf' },
  });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const jpeg = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'passeport.jpg', { type: 'image/jpeg' });

describe('POST /api/procedures/[slug]/documents', () => {
  it('404s for an unknown slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never, ctxFor('unknown'));
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not Complet tier', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('COMPLET_REQUIRED');
  });

  it('403s when the caller has no access at all', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(403);
  });

  it('400s for a checklistItemId that does not exist on this procedure', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'unknown-item', file: jpeg() }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNKNOWN_CHECKLIST_ITEM');
  });

  it('uploads with type authenticated and upserts ProcedureDocument on success', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.upsert.mockResolvedValue({
      checklistItemId: 'passeport-valide',
      filename: 'passeport.jpg',
    } as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ checklistItemId: 'passeport-valide', filename: 'passeport.jpg', uploaded: true });
    expect(prismaMock.procedureDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_procedureId_checklistItemId: {
            userId: 'user-1',
            procedureId: 'proc_1',
            checklistItemId: 'passeport-valide',
          },
        },
      }),
    );
  });

  it('magic byte mismatch returns 415', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const fakeJpeg = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'passeport.jpg', {
      type: 'image/jpeg',
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: fakeJpeg }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(415);
  });

  it('storage not configured returns 503', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(503);
  });

  it('csrf failure returns 403 before touching the DB', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never, ctxFor('campus-france'));
    expect(res.status).toBe(403);
    expect(prismaMock.procedure.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter frontend exec vitest run src/app/api/procedures/\[slug\]/documents/route.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/api/procedures/[slug]/documents"
git commit -m "feat(api): add POST /api/procedures/[slug]/documents checklist upload (Phase 5)"
```

---

### Task 8: `GET /api/procedures/[slug]/documents/[itemId]/url` — signed delivery

**Files:**
- Create: `frontend/src/app/api/procedures/[slug]/documents/[itemId]/url/route.ts`
- Create: `frontend/src/app/api/procedures/[slug]/documents/[itemId]/url/route.test.ts`

**Interfaces:**
- Consumes: `getSignedDeliveryUrl` (Task 4).
- Produces: `{ url: string; expiresAt: string }`, consumed by Task 12 (`ChecklistItemUpload` component).

- [ ] **Step 1: Write the route**

Create `frontend/src/app/api/procedures/[slug]/documents/[itemId]/url/route.ts`:

```typescript
// Doxi Phase 5 — GET /api/procedures/[slug]/documents/[itemId]/url. The
// only path to a procedure document's bytes: mints a Cloudinary signed URL
// with a 300s TTL on every call, never persisted. 404 (not 403) whether the
// procedure/document doesn't exist or the caller isn't Complet-tier — same
// convention as every other non-owned-resource lookup in this codebase.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getSignedDeliveryUrl } from '@/lib/server/upload/cloudinary-client';

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; itemId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) return auth;

    const { slug, itemId } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!procedure) {
      return NextResponse.json(
        { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const access = await prisma.procedureAccess.findUnique({
      where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
      select: { tier: true },
    });
    if (access?.tier !== 'COMPLET') {
      return NextResponse.json(
        { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const doc = await prisma.procedureDocument.findUnique({
      where: {
        userId_procedureId_checklistItemId: {
          userId: auth.user.sub,
          procedureId: procedure.id,
          checklistItemId: itemId,
        },
      },
      select: { cloudinaryPublicId: true, resourceType: true },
    });
    if (!doc) {
      return NextResponse.json(
        { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const url = getSignedDeliveryUrl(doc.cloudinaryPublicId, doc.resourceType, expiresAt);

    return NextResponse.json(
      { url, expiresAt: new Date(expiresAt * 1000).toISOString() },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 2: Write the test**

Create `frontend/src/app/api/procedures/[slug]/documents/[itemId]/url/route.test.ts`:

```typescript
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  getSignedDeliveryUrl: vi.fn(
    (publicId: string, resourceType: string, expiresAt: number) =>
      `https://api.cloudinary.com/v1_1/test/${resourceType}/download?public_id=${publicId}&expires_at=${expiresAt}`,
  ),
}));

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

function makeGet(): NextRequest {
  return new NextRequest('http://localhost/api/procedures/campus-france/documents/passeport-valide/url');
}

function ctxFor(slug: string, itemId: string) {
  return { params: Promise.resolve({ slug, itemId }) };
}

describe('GET /api/procedures/[slug]/documents/[itemId]/url', () => {
  it('404s for an unknown procedure slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeGet(), ctxFor('unknown', 'passeport-valide'));
    expect(res.status).toBe(404);
  });

  it('404s (not 403) when the caller is not Complet tier', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1' } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const { GET } = await import('./route');
    const res = await GET(makeGet(), ctxFor('campus-france', 'passeport-valide'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('404s when no document exists for this checklist item', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1' } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.findUnique.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeGet(), ctxFor('campus-france', 'passeport-valide'));
    expect(res.status).toBe(404);
  });

  it('returns a signed url with a future expiresAt when the document exists', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1' } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.findUnique.mockResolvedValue({
      cloudinaryPublicId: 'procedures/user-1/proc_1/passeport-valide',
      resourceType: 'image',
    } as never);
    const { GET } = await import('./route');
    const before = Date.now();
    const res = await GET(makeGet(), ctxFor('campus-france', 'passeport-valide'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('procedures/user-1/proc_1/passeport-valide');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter frontend exec vitest run "src/app/api/procedures/[slug]/documents/[itemId]/url/route.test.ts"
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/api/procedures/[slug]/documents/[itemId]"
git commit -m "feat(api): add signed document delivery URL route (Phase 5)"
```

---

### Task 9: `AiProvider.analyzeCv` — CV weak-point analysis

**Files:**
- Modify: `frontend/src/lib/server/ai/provider.ts`
- Modify: `frontend/src/lib/server/ai/claude.ts`

**Interfaces:**
- Consumes: `GeneratedCv` type from `frontend/src/lib/validation/cv-wizard.ts` (existing, Phase 3).
- Produces: `AiProvider.analyzeCv(input: CvAnalysisInput): Promise<CvAnalysis>`, consumed by Task 11 (`/analyze` route).

- [ ] **Step 1: Extend the `AiProvider` interface**

Open `frontend/src/lib/server/ai/provider.ts`. Replace its full contents:

```typescript
/**
 * Provider-agnostic AI interface. Mirrors payments/provider.ts's shape:
 * routes consume `AiProvider`, never the concrete Claude adapter, so
 * swapping/adding providers is one wiring change in `index.ts`.
 */
import type { CvAnswers, GeneratedCv } from '@/lib/validation/cv-wizard';

export interface CvGenerationInput {
  answers: CvAnswers;
}

// Phase 5 — CV weak-point analysis, contextualized to the procedure the
// student purchased Complet access for.
export interface CvAnalysisInput {
  generatedCv: GeneratedCv;
  procedure: { name: string; country: string; field?: string };
}

export interface CvAnalysis {
  points: string[];
}

export interface AiProvider {
  /** Short identifier (used for logging). */
  name: string;

  generateCv(input: CvGenerationInput): Promise<GeneratedCv>;

  analyzeCv(input: CvAnalysisInput): Promise<CvAnalysis>;
}
```

- [ ] **Step 2: Implement `analyzeCv` in the Claude adapter**

Open `frontend/src/lib/server/ai/claude.ts`. Add the import and tool/prompt constants after the existing `CV_TOOL` block, then add the `analyzeCv` method to the returned provider object.

Add to the top import line:

```typescript
import { generatedCvSchema, type CvAnswers, type GeneratedCv } from '@/lib/validation/cv-wizard';
import { z } from 'zod';
import type { AiProvider, CvGenerationInput, CvAnalysisInput, CvAnalysis } from './provider';
```

Add after the `CV_TOOL` constant declaration (before `function buildSystemPrompt()`):

```typescript
const ANALYZE_TOOL_NAME = 'emit_cv_analysis';

const CV_ANALYSIS_TOOL = {
  name: ANALYZE_TOOL_NAME,
  description: 'Emit a list of concrete improvement points for the CV.',
  input_schema: {
    type: 'object' as const,
    properties: {
      points: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '3 to 6 concrete, French-language suggestions to improve this CV.',
      },
    },
    required: ['points'],
  },
};

const cvAnalysisSchema = z.object({ points: z.array(z.string()) });
```

Add after `buildUserPrompt()`:

```typescript
function buildAnalysisSystemPrompt(): string {
  return [
    'Tu es un assistant qui aide des étudiants ouest-africains à améliorer leur CV pour une ' +
      'candidature à une procédure précise (bourse, admission, visa études).',
    'On te donne un CV déjà rédigé et le nom/pays/domaine de la procédure ciblée. Relis le CV ' +
      'et propose entre 3 et 6 points d’amélioration concrets, en français, en tutoiement (tu ' +
      't’adresses directement à l’étudiant cette fois).',
    'Chaque point doit être actionnable (ce qu’il faut changer, pas juste un constat) et tenir ' +
      'compte du pays et du domaine de la procédure visée.',
    'RÈGLE ABSOLUE : ne juge que le contenu réellement présent dans le CV fourni — n’invente ' +
      'aucun fait sur l’étudiant.',
    'Réponds uniquement en appelant l’outil emit_cv_analysis.',
  ].join('\n');
}

function buildAnalysisUserPrompt(input: CvAnalysisInput): string {
  return JSON.stringify({ cv: input.generatedCv, procedure: input.procedure }, null, 2);
}
```

Add `analyzeCv` to the object returned by `createClaudeProvider`, right after `generateCv`'s closing brace (so the returned object has both `name`, `generateCv`, and now `analyzeCv`):

```typescript
    async analyzeCv(input: CvAnalysisInput): Promise<CvAnalysis> {
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        system: buildAnalysisSystemPrompt(),
        messages: [{ role: 'user', content: buildAnalysisUserPrompt(input) }],
        tools: [CV_ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: ANALYZE_TOOL_NAME },
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error('Claude response did not include the expected tool_use block');
      }

      return cvAnalysisSchema.parse(toolUse.input);
    },
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors. No dedicated test file for this task — `claude.ts`'s prompt-building/tool-parsing code has never been unit-tested directly in this codebase (confirm: `frontend/src/lib/server/ai/index.test.ts` mocks the entire `./claude` module rather than exercising it, and `generateCv` has the same gap). Coverage for `analyzeCv`'s contract comes from Task 11's route tests, which mock `getAiProvider()` — consistent with how `generateCv` is exercised only through `cv/generate/route.test.ts`'s mocked provider, never directly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/server/ai/provider.ts frontend/src/lib/server/ai/claude.ts
git commit -m "feat(ai): add analyzeCv to AiProvider for Complet-tier weak-point analysis (Phase 5)"
```

---

### Task 10: `analyze-limiter.ts` — cost guard for `/analyze`

**Files:**
- Create: `frontend/src/lib/server/cv/analyze-limiter.ts`
- Create: `frontend/src/lib/server/cv/analyze-limiter.test.ts`

**Interfaces:**
- Consumes: `MemoryRateLimitStore`, `RedisRateLimitStore`, `RateLimitStore` from `frontend/src/lib/server/rate-limit-store.ts` (existing, protected — read-only import, same as `generation-limiter.ts` already does).
- Produces: `createAnalyzeLimiter(deps): AnalyzeLimiter` with `.check(userId): Promise<NextResponse | null>`, consumed by Task 11.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/server/cv/analyze-limiter.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createAnalyzeLimiter } from './analyze-limiter';

describe('createAnalyzeLimiter (in-memory, redis absent)', () => {
  let limiter: ReturnType<typeof createAnalyzeLimiter>;

  beforeEach(() => {
    limiter = createAnalyzeLimiter({});
  });

  it('allows the first 20 requests for a user', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await limiter.check('user-1');
      expect(res).toBeNull();
    }
  });

  it('rejects the 21st request with 429', async () => {
    for (let i = 0; i < 20; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    const body = await res?.json();
    expect(body.error).toBe('CV_ANALYSIS_RATE_LIMITED');
  });

  it('tracks separate buckets per user', async () => {
    for (let i = 0; i < 20; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-2');
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter frontend exec vitest run src/lib/server/cv/analyze-limiter.test.ts
```

Expected: FAIL (`./analyze-limiter` module not found).

- [ ] **Step 3: Write the limiter**

Create `frontend/src/lib/server/cv/analyze-limiter.ts`:

```typescript
/**
 * Per-user rate limit for POST /api/procedures/[slug]/analyze — 20
 * analyses per user per 24h. Complet itself is marketed as "illimité" (no
 * product-level cap), but every call hits the Anthropic API, so this is a
 * cost guard against click-spam, not a feature limit. Mirrors
 * cv/generation-limiter.ts's shape exactly — same store primitives, same
 * dependency-injected `redis`.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { Redis } from '@upstash/redis';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../rate-limit-store';
import { log } from '../observability/log';

export interface CreateAnalyzeLimiterDeps {
  redis?: Redis;
}

export interface AnalyzeLimiter {
  check(userId: string): Promise<NextResponse | null>;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ANALYSES = 20;

export function createAnalyzeLimiter(deps: CreateAnalyzeLimiterDeps): AnalyzeLimiter {
  if (!deps.redis) {
    log.warn('cv-analyze rate limiter using in-memory fallback (Redis absent)');
  }

  const store: RateLimitStore = deps.redis
    ? new RedisRateLimitStore({ redis: deps.redis, prefix: 'rl:cv-analyze:', windowMs: WINDOW_MS })
    : new MemoryRateLimitStore({ windowMs: WINDOW_MS });

  return {
    async check(userId: string) {
      const { totalHits, resetTime } = await store.increment(`user:${userId}`);
      if (totalHits > MAX_ANALYSES) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: 'CV_ANALYSIS_RATE_LIMITED',
            message: `Tu as atteint la limite de 20 analyses aujourd'hui, réessaie demain.`,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(MAX_ANALYSES),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(resetTime.getTime() / 1000)),
            },
          },
        );
      }
      return null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter frontend exec vitest run src/lib/server/cv/analyze-limiter.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/server/cv/analyze-limiter.ts frontend/src/lib/server/cv/analyze-limiter.test.ts
git commit -m "feat(cv): add rate limiter for CV weak-point analysis (Phase 5)"
```

---

### Task 11: `POST /api/procedures/[slug]/analyze`

**Files:**
- Create: `frontend/src/app/api/procedures/[slug]/analyze/route.ts`
- Create: `frontend/src/app/api/procedures/[slug]/analyze/route.test.ts`

**Interfaces:**
- Consumes: `getAiProvider` (existing), `AiProvider.analyzeCv` (Task 9), `createAnalyzeLimiter` (Task 10), `generatedCvSchema` (existing, `cv-wizard.ts`).
- Produces: `{ points: string[] }`, consumed by Task 13 (procedure detail page).

- [ ] **Step 1: Write the route**

Create `frontend/src/app/api/procedures/[slug]/analyze/route.ts`:

```typescript
// Doxi Phase 5 — POST /api/procedures/[slug]/analyze. Complet-tier only.
// Live-generates CV weak-point suggestions contextualized to the purchased
// procedure. No persistence — every call is a fresh generation (matches
// "illimité": the student clicks "Analyser mon CV" whenever they want an
// update, no cache to invalidate).
//
// Order mirrors POST /api/cv/generate: the AI-configured check runs BEFORE
// the rate limit, so a misconfigured deploy doesn't burn a user's daily
// quota for requests that never reach the AI at all.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getAiProvider } from '@/lib/server/ai';
import { generatedCvSchema } from '@/lib/validation/cv-wizard';
import { createAnalyzeLimiter } from '@/lib/server/cv/analyze-limiter';

// Module-level limiter — same convention as cv/generate/route.ts's
// module-level `limiter`. Must NOT be constructed inside POST(): a fresh
// limiter per request means hits never accumulate when Redis is absent.
const limiter = createAnalyzeLimiter(redis ? { redis } : {});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { slug } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { slug },
      select: { id: true, name: true, country: true, field: true },
    });
    if (!procedure) {
      return NextResponse.json(
        { error: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const access = await prisma.procedureAccess.findUnique({
      where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
      select: { tier: true },
    });
    if (access?.tier !== 'COMPLET') {
      return NextResponse.json(
        { error: 'COMPLET_REQUIRED', message: 'L’offre Complet est requise pour cette action.' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const profile = await prisma.cvProfile.findUnique({
      where: { userId: auth.user.sub },
      select: { generatedCv: true },
    });
    const parsedCv = generatedCvSchema.safeParse(profile?.generatedCv);
    if (!parsedCv.success) {
      return NextResponse.json(
        {
          error: 'CV_NOT_GENERATED',
          message: 'Génère d’abord ton CV pour recevoir une analyse.',
        },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const ai = getAiProvider();
    if (!ai) {
      return NextResponse.json(
        { error: 'AI_NOT_CONFIGURED', message: "L'analyse IA n'est pas encore disponible." },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const limited = await limiter.check(auth.user.sub);
    if (limited) return limited;

    let analysis;
    try {
      analysis = await ai.analyzeCv({
        generatedCv: parsedCv.data,
        procedure: {
          name: procedure.name,
          country: procedure.country,
          field: procedure.field ?? undefined,
        },
      });
    } catch {
      return NextResponse.json(
        { error: 'AI_ANALYSIS_FAILED', message: 'L’analyse a échoué, réessaie dans un instant.' },
        { status: 502, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return NextResponse.json(
      { points: analysis.points },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 2: Write the test**

Create `frontend/src/app/api/procedures/[slug]/analyze/route.test.ts`:

```typescript
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

const analyzeCvMock = vi.fn(async () => ({ points: ['Ajoute des chiffres à tes réalisations.'] }));
vi.mock('@/lib/server/ai', () => ({
  getAiProvider: vi.fn(() => ({ name: 'claude', generateCv: vi.fn(), analyzeCv: analyzeCvMock })),
}));

vi.mock('@/lib/server/redis', () => ({ redis: null }));

const GENERATED_CV = { summary: 'Étudiant motivé.', sections: [{ title: 'Éducation', bullets: ['Licence'] }] };

function makePost(): NextRequest {
  return new NextRequest('http://localhost/api/procedures/campus-france/analyze', { method: 'POST' });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  analyzeCvMock.mockClear();
});

describe('POST /api/procedures/[slug]/analyze', () => {
  it('404s for an unknown slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('unknown'));
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not Complet tier', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1', name: 'Campus France', country: 'France', field: null } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('COMPLET_REQUIRED');
  });

  it('400s CV_NOT_GENERATED when the profile has no generatedCv', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1', name: 'Campus France', country: 'France', field: null } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: null } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('CV_NOT_GENERATED');
    expect(analyzeCvMock).not.toHaveBeenCalled();
  });

  it('returns points on success and passes procedure context to analyzeCv', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1', name: 'Campus France', country: 'France', field: null } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: GENERATED_CV } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toEqual(['Ajoute des chiffres à tes réalisations.']);
    expect(analyzeCvMock).toHaveBeenCalledWith({
      generatedCv: GENERATED_CV,
      procedure: { name: 'Campus France', country: 'France', field: undefined },
    });
  });

  it('502s AI_ANALYSIS_FAILED when the provider throws', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1', name: 'Campus France', country: 'France', field: null } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: GENERATED_CV } as never);
    analyzeCvMock.mockRejectedValueOnce(new Error('Anthropic down'));
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AI_ANALYSIS_FAILED');
  });

  it('503s AI_NOT_CONFIGURED when no provider is available', async () => {
    const { getAiProvider } = await import('@/lib/server/ai');
    (getAiProvider as unknown as Mock).mockReturnValueOnce(null);
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1', name: 'Campus France', country: 'France', field: null } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: GENERATED_CV } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter frontend exec vitest run "src/app/api/procedures/[slug]/analyze/route.test.ts"
```

Expected: all 6 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/api/procedures/[slug]/analyze"
git commit -m "feat(api): add POST /api/procedures/[slug]/analyze CV weak-point endpoint (Phase 5)"
```

---

### Task 12: `ChecklistItemUpload` component

**Files:**
- Create: `frontend/src/components/procedures/ChecklistItemUpload.tsx`

**Interfaces:**
- Consumes: `POST /api/procedures/[slug]/documents` (Task 7, raw `fetch` — NOT the `api()` wrapper, which always JSON-stringifies its body and cannot send `multipart/form-data`), `GET /api/procedures/[slug]/documents/[itemId]/url` (Task 8, via `api()` — plain JSON).
- Produces: `<ChecklistItemUpload slug item onUploaded />`, consumed by Task 13.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/procedures/ChecklistItemUpload.tsx`:

```tsx
// Doxi Phase 5 — per-checklist-item file upload widget for the Complet
// tier. Uses a raw `fetch` for the upload call (not the shared `api()`
// wrapper, which always sends `Content-Type: application/json` and
// `JSON.stringify`s its body — incompatible with `multipart/form-data`).
// `api()` itself is a protected file (lib/api.ts) so this duplicates its
// minimal CSRF-token-read logic locally rather than modifying it.
'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { Button, Badge } from '@/components/ui';
import { API_URL, COOKIE_PREFIX } from '@/lib/constants';

export interface ChecklistItemUploadItem {
  id: string;
  title: string;
  uploaded?: boolean;
  filename?: string;
}

interface ChecklistItemUploadProps {
  slug: string;
  item: ChecklistItemUploadItem;
  onUploaded: (itemId: string, filename: string) => void;
}

function getCsrfTokenForUpload(): string | null {
  if (typeof window === 'undefined') return null;
  const key = `${COOKIE_PREFIX}-csrf`;
  const fromStorage = localStorage.getItem(key);
  if (fromStorage) return fromStorage;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export function ChecklistItemUpload({ slug, item, onUploaded }: ChecklistItemUploadProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file to re-upload
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('checklistItemId', item.id);
      fd.append('file', file);
      const csrfToken = getCsrfTokenForUpload();
      const res = await fetch(`${API_URL}/api/procedures/${slug}/documents`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || 'Échec de l’envoi.');
      }
      const data = (await res.json()) as { filename: string };
      onUploaded(item.id, data.filename);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Échec de l’envoi.', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleView() {
    setViewing(true);
    try {
      const data = await api<{ url: string }>(`/api/procedures/${slug}/documents/${item.id}/url`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast(apiErrorMessage(err, 'Impossible d’ouvrir ce document.'), 'error');
    } finally {
      setViewing(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-charcoal-900/85">{item.title}</p>
        {item.uploaded ? (
          <Badge variant="success" className="mt-1">
            {item.filename ?? 'Envoyé'}
          </Badge>
        ) : (
          <Badge variant="neutral" className="mt-1">
            Manquant
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.uploaded && (
          <Button variant="ghost" size="sm" loading={viewing} onClick={handleView}>
            Voir
          </Button>
        )}
        <label>
          <Button
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={(e) => {
              e.preventDefault();
              (e.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement)?.click();
            }}
          >
            {item.uploaded ? 'Remplacer' : 'Envoyer'}
          </Button>
          <input type="file" className="hidden" onChange={handleFileChange} />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors. No dedicated unit test — this component has no server logic of its own (it's a thin wrapper over the two routes already covered by Task 7/8's tests); Task 13's manual verification step exercises it end-to-end, matching the established precedent for this codebase's other `'use client'` pages (Phase 4's `/procedures/[slug]/page.tsx` and the order-return pages also shipped without component-level tests, verified manually instead — no browser automation tool is available in this environment).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/procedures/ChecklistItemUpload.tsx
git commit -m "feat(ui): add ChecklistItemUpload component (Phase 5)"
```

---

### Task 13: `/procedures/[slug]` page — tier-aware UI

**Files:**
- Modify: `frontend/src/app/procedures/[slug]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/procedures/[slug]` (Task 6, now returns `tier`/`completPriceFcfa`/`upgradePriceFcfa`/per-item `uploaded`), `ChecklistItemUpload` (Task 12), `POST /api/procedures/[slug]/analyze` (Task 11).
- Produces: the finished Phase 5 UI — no later task depends on this one.

- [ ] **Step 1: Replace the page**

Replace the entire contents of `frontend/src/app/procedures/[slug]/page.tsx`:

```tsx
// /procedures/[slug] — détail d'une procédure : checklist si déjà achetée
// (avec upload de documents + analyse IA pour l'offre Complet), sinon
// boutons d'achat (Simple / Complet) via le flux Bictorys existant
// (POST /api/orders, inchangé — voir CLAUDE.md).
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Badge, Button, Accordion, type AccordionItemData } from '@/components/ui';
import { ChecklistItemUpload, type ChecklistItemUploadItem } from '@/components/procedures/ChecklistItemUpload';
import { formatPrice, isInAppBrowser } from '@/lib/utils';

type Tier = 'SIMPLE' | 'COMPLET' | null;

interface ChecklistItem extends ChecklistItemUploadItem {
  description?: string;
}

interface ProcedureDetail {
  id: string;
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  priceFcfa: number;
  completPriceFcfa: number;
  upgradePriceFcfa: number;
  hasAccess: boolean;
  tier: Tier;
  checklist?: ChecklistItem[];
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function ProcedureDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [procedure, setProcedure] = useState<ProcedureDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState<'SIMPLE' | 'COMPLET' | null>(null);
  const [inAppWarning, setInAppWarning] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisPoints, setAnalysisPoints] = useState<string[] | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [needsCv, setNeedsCv] = useState(false);

  useEffect(() => {
    setInAppWarning(isInAppBrowser());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<ProcedureDetail>(`/api/procedures/${slug}`)
      .then((data) => {
        if (!cancelled) setProcedure(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.status === 404
              ? 'Cette procédure n’existe pas.'
              : apiErrorMessage(err, 'Impossible de charger cette procédure.'),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleBuy(tier: 'SIMPLE' | 'COMPLET') {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!procedure) return;

    const amount =
      tier === 'SIMPLE'
        ? procedure.priceFcfa
        : procedure.tier === 'SIMPLE'
          ? procedure.upgradePriceFcfa
          : procedure.completPriceFcfa;

    setBuying(tier);
    try {
      const res = await api<{ id: string; paymentUrl: string; status: string }>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          amount,
          currency: 'XOF',
          metadata: {
            tier,
            procedureId: procedure.id,
            procedureSlug: procedure.slug,
          },
        },
      });
      window.location.href = res.paymentUrl;
    } catch (err) {
      toast(apiErrorMessage(err, 'Le paiement n’a pas pu être initié.'), 'error');
      setBuying(null);
    }
  }

  function handleDocumentUploaded(itemId: string, filename: string) {
    setProcedure((prev) =>
      prev
        ? {
            ...prev,
            checklist: prev.checklist?.map((item) =>
              item.id === itemId ? { ...item, uploaded: true, filename } : item,
            ),
          }
        : prev,
    );
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisError(null);
    setNeedsCv(false);
    try {
      const res = await api<{ points: string[] }>(`/api/procedures/${slug}/analyze`, { method: 'POST' });
      setAnalysisPoints(res.points);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CV_NOT_GENERATED') {
        setNeedsCv(true);
        setAnalysisError('Génère d’abord ton CV pour recevoir une analyse.');
      } else {
        setAnalysisError(apiErrorMessage(err, 'L’analyse a échoué, réessaie dans un instant.'));
      }
    } finally {
      setAnalyzing(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-error-600">{loadError}</p>
      </main>
    );
  }

  if (!procedure) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  const checklistItems: AccordionItemData[] = (procedure.checklist ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    content:
      procedure.tier === 'COMPLET' ? (
        <ChecklistItemUpload slug={slug} item={item} onUploaded={handleDocumentUploaded} />
      ) : (
        (item.description ?? '')
      ),
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        {procedure.country}
        {procedure.field ? ` · ${procedure.field}` : ''}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">{procedure.name}</h1>
      <p className="mt-2 text-sm text-charcoal-900/70">{procedure.tagline}</p>

      {procedure.hasAccess ? (
        <>
          {procedure.tier === 'COMPLET' && (
            <Card bordered className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium text-ink-900">Analyse IA de ton CV</h2>
                <Button variant="secondary" size="sm" loading={analyzing} onClick={handleAnalyze}>
                  Analyser mon CV
                </Button>
              </div>
              {analysisError && (
                <div className="mt-3">
                  <p className="text-sm text-error-600">{analysisError}</p>
                  {needsCv && (
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => router.push('/cv')}>
                      Aller à mon CV
                    </Button>
                  )}
                </div>
              )}
              {analysisPoints && (
                <ul className="mt-3 flex flex-col gap-2 text-sm text-charcoal-900/80">
                  {analysisPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 text-seal-gold" aria-hidden="true">
                        •
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card bordered className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-ink-900">Checklist des documents</h2>
              <Badge variant="success">
                {procedure.tier === 'COMPLET' ? 'Complet' : 'Débloquée'}
              </Badge>
            </div>
            <div className="mt-4">
              {checklistItems.length > 0 ? (
                <Accordion items={checklistItems} type="multiple" />
              ) : (
                <p className="text-sm text-charcoal-900/60">Aucun document listé.</p>
              )}
            </div>
          </Card>

          {procedure.tier === 'SIMPLE' && (
            <Card bordered className="mt-6 border-seal-gold">
              <p className="text-sm text-charcoal-900/75">
                Passe à l’offre Complet pour suivre l’upload de tes documents et recevoir une
                analyse IA de ton CV pour cette procédure.
              </p>
              <Button
                variant="primary"
                className="mt-4 w-full"
                loading={buying === 'COMPLET'}
                onClick={() => handleBuy('COMPLET')}
              >
                Passer à Complet (+{formatPrice(procedure.upgradePriceFcfa)} FCFA)
              </Button>
            </Card>
          )}
        </>
      ) : (
        <Card bordered className="mt-8">
          <p className="text-sm text-charcoal-900/75">
            Débloque la checklist complète des documents requis pour cette procédure, avec la marche
            à suivre détaillée.
          </p>
          {inAppWarning && (
            <p className="mt-4 rounded-lg bg-seal-gold/10 px-3 py-2 text-xs text-ink-900">
              Pour un paiement mobile money sans problème, ouvre ce lien dans Chrome ou Safari
              plutôt que dans cette application.
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <Button variant="secondary" loading={buying === 'SIMPLE'} onClick={() => handleBuy('SIMPLE')}>
              Débloquer Simple pour {formatPrice(procedure.priceFcfa)} FCFA
            </Button>
            <Button variant="primary" loading={buying === 'COMPLET'} onClick={() => handleBuy('COMPLET')}>
              Débloquer Complet pour {formatPrice(procedure.completPriceFcfa)} FCFA
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual verification**

Start the dev server (`pnpm --filter frontend run dev`) and walk through, with a real logged-in user:
1. A procedure with no access shows both "Débloquer Simple" and "Débloquer Complet" buttons with the correct amounts from the API response.
2. Grant `SIMPLE` access directly in the dev DB (or via a real Bictorys-configured checkout) for a test procedure — confirm the read-only checklist renders and the "Passer à Complet" banner shows the `upgradePriceFcfa` amount (15 000).
3. Grant `COMPLET` access — confirm each checklist item now renders the `ChecklistItemUpload` widget instead of its description, that a real file upload succeeds and flips the item to "Remplacer"/shows the filename badge, and that "Voir" opens a working signed URL in a new tab.
4. Click "Analyser mon CV" with no CV generated yet — confirm the `CV_NOT_GENERATED` message and "Aller à mon CV" link appear. Generate a CV via `/cv`, return, click "Analyser mon CV" again — confirm bullet points render.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/procedures/[slug]/page.tsx
git commit -m "feat(ui): wire Complet tier — upload, upgrade CTA, CV analysis (Phase 5)"
```

---

## Final verification (after all 13 tasks)

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green, and the production build's route list includes the three new dynamic routes under `/api/procedures/[slug]/documents*` and `/api/procedures/[slug]/analyze`.
