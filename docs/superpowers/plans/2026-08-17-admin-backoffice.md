# Doxi Phase 7: Admin back-office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Doxi-specific admin back-office: support visibility (who bought what,
dossier status, document review) and catalog management (create/edit/archive
procedures), on top of the existing generic `requireAdmin`/`AdminAction` starter
pattern. Approved design: `docs/superpowers/specs/2026-08-17-admin-backoffice-design.md`.

**Architecture:** One new `Procedure.isArchived` column; two existing admin routes
extended with a field each (`orders` gets `metadata`, `users/[id]` gets nested
`procedureAccess`/`procedureDocuments`); three new API routes (signed document URL,
procedure list+create, procedure detail+edit); seven new `/admin/*` frontend pages plus
one shared `ProcedureForm` component, none of which exist today.

**Tech Stack:** Next.js 16 App Router Route Handlers, Prisma 5 + Neon, Zod, Vitest +
vitest-mock-extended, Tailwind v4 + existing Doxi design tokens, framer-motion.

## Global Constraints

- Every Route Handler exports `export const runtime = 'nodejs'`.
- Mutating routes verify CSRF (`verifyCsrf(req)` from `@/lib/server/auth`) BEFORE
  `requireAdmin`, exactly as `frontend/src/app/api/admin/users/[id]/role/route.ts` does.
- Every admin route sequence: `makeRequestContext` → `withRequestContext` →
  (`verifyCsrf` if mutating) → `requireAdmin('ADMIN')` → `enforceAdminRateLimit(auth.admin.id)`
  → Zod parse → handler logic → (`logAdminAction` if mutating or sensitive-read).
- `requireAdmin`/`logAdminAction`/`slugify`/`ensureUniqueSlug` are imported only, never
  modified (protected files per `CLAUDE.md`).
- Every mutation calls `logAdminAction(prisma, {...})` — no exceptions. Document *views*
  also call it (`action: 'document.view'`) since access is open to any `ADMIN` and audit
  is the substitute control.
- Zod validation failures return `{ error: 'VALIDATION_FAILED', message }` (generic code,
  matches every existing `/api/admin/*` route — do not invent per-field codes).
- Not-found responses use stable codes: `USER_NOT_FOUND`, `PROCEDURE_NOT_FOUND`,
  `DOCUMENT_NOT_FOUND`.
- `priceFcfa` and `slug` are never accepted by any admin procedure endpoint's body schema
  (not even silently ignored via an explicit reject — they're simply absent from the Zod
  shape, matching `PATCH /api/auth/me`'s pattern from Phase 6).
- Signed document URLs: 300s TTL, never persisted, minted fresh on every request — same
  contract as `procedures/[slug]/documents/[itemId]/url/route.ts` (Phase 5).
- No test file for any new `/admin/*` page or `ProcedureForm` — matches the existing
  convention (zero page/component tests anywhere in this app).
- Mount-only `useEffect(() => { void load(true); }, []);` blocks use a bare empty
  dependency array with NO `// eslint-disable-next-line react-hooks/exhaustive-deps`
  comment. Discovered during Task 11: this project's ESLint config never registers the
  `react-hooks` plugin, and this ESLint version hard-errors (not silently no-ops) on a
  disable comment for an unregistered rule name — confirmed via `pnpm lint`. Do not add
  the plugin/rule to `eslint.config.mjs` to "fix" this — that file is out of scope for
  every task in this plan.
- French, tutoiement copy throughout, matching every other Doxi-facing string in the app.
- No "Retraits" admin screen, no per-procedure buyer list, no price field in any admin
  form — all explicitly out of scope per the approved design.

---

### Task 1: Prisma schema — `Procedure.isArchived`

**Files:**
- Modify: `frontend/prisma/schema.prisma`
- Create: migration under `frontend/prisma/migrations/`

**Interfaces:**
- Produces: `Procedure.isArchived: Boolean` (default `false`, non-nullable). Task 2 filters
  on it; Tasks 6-7 read/write it; Task 12 renders it.

- [ ] **Step 1: Add the field**

Open `frontend/prisma/schema.prisma`. Find the `Procedure` model (around line 352):

```prisma
model Procedure {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String // "Campus France", "Chevening", "Bourse Canada"...
  country   String
  field     String? // domaine si pertinent (ex. "Master", "Ingénierie")
  tagline   String // une phrase d'accroche pour la carte de sélection
  checklist Json // [{ title: string; description?: string }] — révélé après achat
  priceFcfa Int      @default(5000)
  createdAt DateTime @default(now())
```

Replace it with (adds `isArchived` right after `priceFcfa`):

```prisma
model Procedure {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String // "Campus France", "Chevening", "Bourse Canada"...
  country   String
  field     String? // domaine si pertinent (ex. "Master", "Ingénierie")
  tagline   String // une phrase d'accroche pour la carte de sélection
  checklist Json // [{ title: string; description?: string }] — révélé après achat
  priceFcfa Int      @default(5000)
  // Masque la procédure du catalogue public (GET /api/procedures) sans la
  // supprimer — les acheteurs existants (ProcedureAccess) gardent leur accès
  // intact. Une vraie suppression casserait onDelete:Restrict dès qu'un
  // achat existe ; l'archivage (Phase 7) est le seul retrait possible.
  isArchived Boolean @default(false)
  createdAt DateTime @default(now())
```

- [ ] **Step 2: Kill any stale dev server before migrating (Windows file-lock)**

Prisma Client regeneration fails silently if a `next dev` process holds a lock on
`query_engine-windows.dll.node`. Stop any running dev server before continuing. Do NOT
use `taskkill //F //IM node.exe //T` — it kills every Node process machine-wide, not just
the dev server. Find and stop only the specific `next dev` process.

- [ ] **Step 3: Run the migration**

From `frontend/`:

```bash
pnpm db:migrate:dev --name doxi_procedure_archive
```

Expected: a new directory under `frontend/prisma/migrations/` containing
`migration.sql` with `ALTER TABLE "Procedure" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;`,
and Prisma Client regenerated (no TS errors referencing `Procedure.isArchived`).

- [ ] **Step 4: Verify**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(db): add Procedure.isArchived (Phase 7)"
```

---

### Task 2: Public catalog excludes archived procedures

**Files:**
- Modify: `frontend/src/app/api/procedures/route.ts`
- Test: `frontend/src/app/api/procedures/route.test.ts`

**Interfaces:**
- Consumes: `Procedure.isArchived` from Task 1.
- Produces: nothing new consumed by later tasks — this is a leaf change.

- [ ] **Step 1: Write the failing test**

`frontend/src/app/api/procedures/route.test.ts` currently has a no-arg `makeGet()`
helper (fixed to `http://test/api/procedures`) and builds fixture rows as inline object
literals (see the existing `'returns the procedure list without leaking checklist
content'` test) — match that exact style, do not introduce a shared fixture helper.
Add this test inside the existing `describe('GET /api/procedures', ...)` block:

```ts
it('excludes archived procedures via the where clause', async () => {
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

  expect(prismaMock.procedure.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { isArchived: false },
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter frontend exec vitest run src/app/api/procedures/route.test.ts
```

Expected: FAIL — `where.isArchived` is `undefined`.

- [ ] **Step 3: Implement**

In `frontend/src/app/api/procedures/route.ts`, change:

```ts
    const procedures = await prisma.procedure.findMany({
      select: PROCEDURE_LIST_SELECT,
      orderBy: { createdAt: 'asc' },
    });
```

to:

```ts
    const procedures = await prisma.procedure.findMany({
      where: { isArchived: false },
      select: PROCEDURE_LIST_SELECT,
      orderBy: { createdAt: 'asc' },
    });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter frontend exec vitest run src/app/api/procedures/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/procedures/route.ts frontend/src/app/api/procedures/route.test.ts
git commit -m "feat(procedures): exclude archived procedures from public catalog"
```

---

### Task 3: `GET /api/admin/orders` returns `metadata`

**Files:**
- Modify: `frontend/src/app/api/admin/orders/route.ts`
- Test: `frontend/src/app/api/admin/orders/route.test.ts`

**Interfaces:**
- Produces: `AdminOrder.metadata: Prisma.JsonValue | null` in the list response items —
  Task 11 (orders page) reads `metadata.procedureId` / `metadata.tier` from this.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/app/api/admin/orders/route.test.ts` (inside the existing
`describe('/api/admin/orders [Wave 1] — list'` block, alongside the existing
`'metadata excluded — confirms whitelist'` assertion which this task inverts):

```ts
  it('GET includes metadata in the select (Phase 7 — procedure/tier visibility)', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      seedOrder({ id: 'o1', metadata: { tier: 'SIMPLE', procedureId: 'proc_1', procedureSlug: 'campus-france' } }),
    ] as never);

    const res = await GET(makeGet('http://test/api/admin/orders'));
    expect(res.status).toBe(200);

    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect((args?.select as Record<string, unknown> | undefined)?.['metadata']).toBe(true);

    const body = (await res.json()) as { items: Array<{ metadata: unknown }> };
    expect(body.items[0]?.metadata).toEqual({
      tier: 'SIMPLE',
      procedureId: 'proc_1',
      procedureSlug: 'campus-france',
    });
  });
```

Also update the pre-existing test titled `'GET returns paginated orders for ADMIN sorted
by createdAt DESC'` — it currently asserts `metadata` is excluded (`toBeUndefined()`).
Remove or invert that specific assertion line so it doesn't contradict the new test; the
rest of that test's assertions stay as-is.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter frontend exec vitest run src/app/api/admin/orders/route.test.ts
```

Expected: FAIL — `select.metadata` is `undefined`.

- [ ] **Step 3: Implement**

In `frontend/src/app/api/admin/orders/route.ts`, change `ORDER_SELECT`:

```ts
const ORDER_SELECT = {
  id: true,
  userId: true,
  amount: true,
  currency: true,
  status: true,
  customerEmail: true,
  provider: true,
  providerChargeId: true,
  paymentUrl: true,
  paymentMethod: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.OrderSelect;
```

to (add `metadata: true` after `customerEmail: true`):

```ts
const ORDER_SELECT = {
  id: true,
  userId: true,
  amount: true,
  currency: true,
  status: true,
  customerEmail: true,
  metadata: true,
  provider: true,
  providerChargeId: true,
  paymentUrl: true,
  paymentMethod: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.OrderSelect;
```

Update the file's header comment (currently reads "Field whitelist excludes `metadata`
… but includes the essentials") to drop the now-inaccurate "excludes metadata" claim —
replace that sentence with: "`metadata` is included — Doxi orders carry `{tier,
procedureId, procedureSlug}`, needed for the admin orders UI (Phase 7)."

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter frontend exec vitest run src/app/api/admin/orders/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/admin/orders/route.ts frontend/src/app/api/admin/orders/route.test.ts
git commit -m "feat(admin): expose Order.metadata in admin orders list (Phase 7)"
```

---

### Task 4: `GET /api/admin/users/[id]` returns purchases + documents

**Files:**
- Modify: `frontend/src/app/api/admin/users/[id]/route.ts`
- Test: `frontend/src/app/api/admin/users/[id]/route.test.ts`

**Interfaces:**
- Produces: `AdminUserDetail.procedureAccess: Array<{ tier: string; grantedAt: Date;
  procedure: { id: string; slug: string; name: string } }>` and
  `AdminUserDetail.procedureDocuments: Array<{ id: string; procedureId: string;
  checklistItemId: string; filename: string; mimeType: string; sizeBytes: number;
  uploadedAt: Date }>` — Task 10 (user detail page) renders both arrays; the `id` field on
  each document is what Task 10 sends to the Task 5 route.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/app/api/admin/users/[id]/route.test.ts`:

```ts
it('GET includes procedureAccess and procedureDocuments (Phase 7)', async () => {
  const user = seedAdmin({ id: 'u1', role: 'USER' });
  prismaMock.user.findUnique.mockResolvedValueOnce({
    ...user,
    procedureAccess: [
      {
        tier: 'COMPLET',
        grantedAt: new Date('2026-08-01T00:00:00.000Z'),
        procedure: { id: 'proc_1', slug: 'campus-france', name: 'Campus France' },
      },
    ],
    procedureDocuments: [
      {
        id: 'doc_1',
        procedureId: 'proc_1',
        checklistItemId: 'passport',
        filename: 'passport.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        uploadedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    ],
  } as never);

  const res = await GET(makeGet('http://test/api/admin/users/u1'), {
    params: Promise.resolve({ id: 'u1' }),
  });
  expect(res.status).toBe(200);

  const args = prismaMock.user.findUnique.mock.calls[0]?.[0];
  const select = args?.select as Record<string, unknown> | undefined;
  expect(select?.['procedureAccess']).toBeTruthy();
  expect(select?.['procedureDocuments']).toBeTruthy();

  const body = (await res.json()) as {
    user: { procedureAccess: unknown[]; procedureDocuments: unknown[] };
  };
  expect(body.user.procedureAccess).toHaveLength(1);
  expect(body.user.procedureDocuments).toHaveLength(1);
});
```

Check the existing test file first for its exact `makeGet`/params-passing helper shape
(the route's second argument is `{ params: Promise<{ id: string }> }`) and match it — do
not invent a different call signature than what the file's other tests already use.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter frontend exec vitest run "src/app/api/admin/users/[id]/route.test.ts"
```

Expected: FAIL — `select.procedureAccess` / `select.procedureDocuments` undefined.

- [ ] **Step 3: Implement**

In `frontend/src/app/api/admin/users/[id]/route.ts`, change the `prisma.user.findUnique`
call:

```ts
    const user = await prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
```

to:

```ts
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        procedureAccess: {
          select: {
            tier: true,
            grantedAt: true,
            procedure: { select: { id: true, slug: true, name: true } },
          },
        },
        procedureDocuments: {
          select: {
            id: true,
            procedureId: true,
            checklistItemId: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            uploadedAt: true,
          },
        },
      },
    });
```

`USER_SELECT` stays as its own `const` (still consumed by the list route in the sibling
`route.ts` — do not delete or narrow it).

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter frontend exec vitest run src/app/api/admin/users/\[id\]/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/admin/users/[id]/route.ts" "frontend/src/app/api/admin/users/[id]/route.test.ts"
git commit -m "feat(admin): surface a user's procedure purchases + documents (Phase 7)"
```

---

### Task 5: `GET /api/admin/documents/[documentId]/url` (new)

**Files:**
- Create: `frontend/src/app/api/admin/documents/[documentId]/url/route.ts`
- Test: `frontend/src/app/api/admin/documents/[documentId]/url/route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/server/middleware`), `enforceAdminRateLimit`
  (`@/lib/server/middleware/rate-limit-by-userid`), `logAdminAction`
  (`@/lib/server/admin/audit`), `getSignedDeliveryUrl(publicId, resourceType,
  expiresAtUnixSeconds): string` (`@/lib/server/upload/cloudinary-client`).
- Produces: `GET` handler returning `{ url: string; expiresAt: string }` (200) or
  `{ error: 'DOCUMENT_NOT_FOUND', message }` (404) — Task 10's "Voir" button calls this by
  `ProcedureDocument.id` (the `id` field from Task 4's `procedureDocuments` array).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/admin/documents/[documentId]/url/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));
vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  getSignedDeliveryUrl: vi.fn(() => 'https://res.cloudinary.com/signed/test-url'),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { GET } from './route';
import { seedAdmin } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/documents/[documentId]/url', () => {
  it('GET returns a signed URL for a valid document id and logs the view', async () => {
    prismaMock.procedureDocument.findUnique.mockResolvedValueOnce({
      id: 'doc_1',
      userId: 'user_1',
      cloudinaryPublicId: 'procedures/user_1/proc_1/passport',
      resourceType: 'image',
    } as never);

    const res = await GET(makeGet('http://test/api/admin/documents/doc_1/url'), {
      params: Promise.resolve({ documentId: 'doc_1' }),
    });

    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toBe('https://res.cloudinary.com/signed/test-url');
    expect(typeof body.expiresAt).toBe('string');

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin_1',
        action: 'document.view',
        targetType: 'ProcedureDocument',
        targetId: 'doc_1',
        metadata: { ownerUserId: 'user_1' },
      }),
    );
  });

  it('GET returns 404 DOCUMENT_NOT_FOUND for an unknown id', async () => {
    prismaMock.procedureDocument.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeGet('http://test/api/admin/documents/missing/url'), {
      params: Promise.resolve({ documentId: 'missing' }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DOCUMENT_NOT_FOUND');
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('GET propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/documents/doc_1/url'), {
      params: Promise.resolve({ documentId: 'doc_1' }),
    });
    expect(res.status).toBe(403);
    expect(prismaMock.procedureDocument.findUnique).not.toHaveBeenCalled();
  });

  it('rate limits admin per-userId — propagates 429', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/documents/doc_1/url'), {
      params: Promise.resolve({ documentId: 'doc_1' }),
    });
    expect(res.status).toBe(429);
    expect(prismaMock.procedureDocument.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter frontend exec vitest run "src/app/api/admin/documents/[documentId]/url/route.test.ts"
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/app/api/admin/documents/[documentId]/url/route.ts`:

```ts
// Doxi Phase 7 — GET /api/admin/documents/[documentId]/url. Mints a
// short-lived signed Cloudinary URL for one ProcedureDocument so any ADMIN
// can review an uploaded passport/transcript/etc. Access is open to every
// ADMIN (not SUPERADMIN-only, per the approved Phase 7 design) — every call
// is logged via logAdminAction as the substitute control.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getSignedDeliveryUrl } from '@/lib/server/upload/cloudinary-client';

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { documentId } = await ctx.params;
    const doc = await prisma.procedureDocument.findUnique({
      where: { id: documentId },
      select: { id: true, userId: true, cloudinaryPublicId: true, resourceType: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const url = getSignedDeliveryUrl(doc.cloudinaryPublicId, doc.resourceType, expiresAt);

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'document.view',
      targetType: 'ProcedureDocument',
      targetId: doc.id,
      metadata: { ownerUserId: doc.userId },
    });

    return NextResponse.json(
      { url, expiresAt: new Date(expiresAt * 1000).toISOString() },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter frontend exec vitest run "src/app/api/admin/documents/[documentId]/url/route.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/admin/documents/[documentId]/url/route.ts" "frontend/src/app/api/admin/documents/[documentId]/url/route.test.ts"
git commit -m "feat(admin): add signed document-view URL route (Phase 7)"
```

---

### Task 6: `GET`/`POST /api/admin/procedures` (new)

**Files:**
- Create: `frontend/src/app/api/admin/procedures/route.ts`
- Test: `frontend/src/app/api/admin/procedures/route.test.ts`
- Modify: `frontend/src/test-utils/admin-fixtures.ts` (add `seedProcedure`)

**Interfaces:**
- Consumes: `checklistSchema` (`@/lib/server/procedures/checklist.ts`), `slugify` +
  `ensureUniqueSlug` (`@/lib/server/slug.ts`), `clampLimit`/`cursorWhere`/`buildPage`/
  `decodeCursor` (`@/lib/server/pagination/paginate.ts`).
- Produces: `POST` response `{ procedure: { id, slug, name, country, field, tagline,
  isArchived, createdAt } }` (201) — Task 14 posts to this and redirects using the
  returned `id`. `GET` response `{ items: [...same shape...], nextCursor }` — Task 11
  fetches this to build its procedure-name lookup Map; Task 12 lists from it.
- New test fixture: `seedProcedure(overrides?): Procedure` in `admin-fixtures.ts`, same
  pattern as `seedOrder`/`seedWithdrawal` in that file — Task 7's tests also use it.

- [ ] **Step 1: Add the `seedProcedure` fixture**

In `frontend/src/test-utils/admin-fixtures.ts`, add `Procedure` to the existing
`@prisma/client` type import:

```ts
import type { User, Order, OutboxEvent, EmailJob, Withdrawal, Procedure, Prisma } from '@prisma/client';
```

Then add near the bottom of the file (after `seedWithdrawal`):

```ts
// ────────────────────────────────────────────────────────────────────
// Phase 7 — Procedure fixtures (admin catalog CRUD)
// ────────────────────────────────────────────────────────────────────

interface ProcedureOverrides {
  id?: string;
  slug?: string;
  name?: string;
  country?: string;
  field?: string | null;
  tagline?: string;
  checklist?: Prisma.JsonValue;
  priceFcfa?: number;
  isArchived?: boolean;
  createdAt?: Date;
}

export function seedProcedure(overrides: ProcedureOverrides = {}): Procedure {
  return {
    id: overrides.id ?? `proc_${Math.random().toString(36).slice(2, 10)}`,
    slug: overrides.slug ?? 'campus-france',
    name: overrides.name ?? 'Campus France',
    country: overrides.country ?? 'France',
    field: overrides.field ?? null,
    tagline: overrides.tagline ?? 'Étudie en France via Campus France.',
    checklist: (overrides.checklist ?? [
      { id: 'passport', title: 'Copie du passeport' },
    ]) as Prisma.JsonValue,
    priceFcfa: overrides.priceFcfa ?? 5000,
    isArchived: overrides.isArchived ?? false,
    createdAt: overrides.createdAt ?? FROZEN_NOW,
  } as Procedure;
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/app/api/admin/procedures/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { verifyCsrf } from '@/lib/server/auth';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { GET, POST } from './route';
import { seedAdmin, seedProcedure } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockVerifyCsrf.mockReturnValue(null);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/procedures — list', () => {
  it('GET returns paginated procedures including archived ones', async () => {
    const active = seedProcedure({ id: 'p1', isArchived: false });
    const archived = seedProcedure({ id: 'p2', isArchived: true });
    prismaMock.procedure.findMany.mockResolvedValueOnce([active, archived] as never);

    const res = await GET(makeGet('http://test/api/admin/procedures'));
    expect(res.status).toBe(200);

    const args = prismaMock.procedure.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['isArchived']).toBeUndefined();

    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('GET propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/procedures'));
    expect(res.status).toBe(403);
    expect(prismaMock.procedure.findMany).not.toHaveBeenCalled();
  });
});

describe('/api/admin/procedures — create', () => {
  const validBody = {
    name: 'Chevening',
    country: 'Royaume-Uni',
    tagline: 'Bourse Chevening pour un master au Royaume-Uni.',
    checklist: [{ id: 'passport', title: 'Copie du passeport' }],
  };

  it('POST creates a procedure with a slugified, unique slug and logs the action', async () => {
    const created = seedProcedure({ id: 'p1', slug: 'chevening', name: 'Chevening' });
    prismaMock.procedure.create.mockResolvedValueOnce({
      id: created.id,
      slug: created.slug,
    } as never);

    const res = await POST(makePost('http://test/api/admin/procedures', validBody));
    expect(res.status).toBe(201);

    const body = (await res.json()) as { procedure: { id: string; slug: string } };
    expect(body.procedure.slug).toBe('chevening');

    const createArgs = prismaMock.procedure.create.mock.calls[0]?.[0];
    expect((createArgs?.data as { slug?: string })?.slug).toBe('chevening');

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin_1',
        action: 'procedure.create',
        targetType: 'Procedure',
        targetId: 'p1',
      }),
    );
  });

  it('POST retries with a -2 suffix on slug collision', async () => {
    prismaMock.procedure.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'p2', slug: 'chevening-2' } as never);

    const res = await POST(makePost('http://test/api/admin/procedures', validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { procedure: { slug: string } };
    expect(body.procedure.slug).toBe('chevening-2');
    expect(prismaMock.procedure.create).toHaveBeenCalledTimes(2);
  });

  it('POST returns 400 VALIDATION_FAILED on an invalid checklist', async () => {
    const res = await POST(
      makePost('http://test/api/admin/procedures', { ...validBody, checklist: 'not-an-array' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.procedure.create).not.toHaveBeenCalled();
  });

  it('POST returns 400 when a required field is missing', async () => {
    const { name: _name, ...withoutName } = validBody;
    void _name;
    const res = await POST(makePost('http://test/api/admin/procedures', withoutName));
    expect(res.status).toBe(400);
    expect(prismaMock.procedure.create).not.toHaveBeenCalled();
  });

  it('POST checks CSRF before requireAdmin', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'CSRF_INVALID' }, { status: 403 }),
    );
    const res = await POST(makePost('http://test/api/admin/procedures', validBody));
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter frontend exec vitest run src/app/api/admin/procedures/route.test.ts
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `frontend/src/app/api/admin/procedures/route.ts`:

```ts
// Doxi Phase 7 — GET/POST /api/admin/procedures. Catalog list (includes
// archived rows so an admin can unarchive) + creation. Slug is derived via
// slugify/ensureUniqueSlug (frontend/src/lib/server/slug.ts) — this is
// their first real caller in the codebase.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { checklistSchema } from '@/lib/server/procedures/checklist';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';

const PROCEDURE_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  isArchived: true,
  createdAt: true,
} as const satisfies Prisma.ProcedureSelect;

const CreateBody = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(100),
  field: z.string().trim().min(1).max(100).optional(),
  tagline: z.string().trim().min(1).max(300),
  checklist: checklistSchema,
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.ProcedureWhereInput = { ...cursorWhere(cursor) };

    const rows = await prisma.procedure.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: PROCEDURE_LIST_SELECT,
    });

    return NextResponse.json(buildPage(rows, limit), {
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // ensureUniqueSlug only resolves after `create` inside the closure has
    // succeeded at least once — createdProcedure is always set by the time
    // we reach the code below. The `!` assertions reflect that invariant
    // rather than relying on cross-closure control-flow narrowing.
    let createdProcedure: { id: string; slug: string } | null = null;
    const slug = await ensureUniqueSlug(slugify(parsed.data.name), async (candidate) => {
      const created = await prisma.procedure.create({
        data: {
          name: parsed.data.name,
          country: parsed.data.country,
          // Conditional spread, not `field: parsed.data.field` — Zod's
          // `.optional()` sets the key to literal `undefined` in the parsed
          // object when absent from input, and exactOptionalPropertyTypes
          // rejects assigning explicit `undefined` to Prisma's `field?: string
          // | null` input type. Omitting the key entirely is required, not
          // just an assignment of undefined to it.
          ...(parsed.data.field !== undefined ? { field: parsed.data.field } : {}),
          tagline: parsed.data.tagline,
          checklist: parsed.data.checklist as unknown as Prisma.InputJsonValue,
          slug: candidate,
        },
        select: { id: true, slug: true },
      });
      createdProcedure = created;
      return created;
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'procedure.create',
      targetType: 'Procedure',
      targetId: createdProcedure!.id,
      metadata: { slug },
    });

    return NextResponse.json(
      { procedure: { id: createdProcedure!.id, slug } },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter frontend exec vitest run src/app/api/admin/procedures/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors (pay attention to `exactOptionalPropertyTypes` on the `field`
optional — `parsed.data.field` is `string | undefined`, which matches Prisma's optional
`field?: string` input type directly, no cast needed).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/api/admin/procedures/route.ts frontend/src/app/api/admin/procedures/route.test.ts frontend/src/test-utils/admin-fixtures.ts
git commit -m "feat(admin): add GET/POST /api/admin/procedures (Phase 7)"
```

---

### Task 7: `GET`/`PATCH /api/admin/procedures/[id]` (new)

**Files:**
- Create: `frontend/src/app/api/admin/procedures/[id]/route.ts`
- Test: `frontend/src/app/api/admin/procedures/[id]/route.test.ts`

**Interfaces:**
- Consumes: `seedProcedure` (Task 6's fixture), `checklistSchema`.
- Produces: `GET` response `{ procedure: { id, slug, name, country, field, tagline,
  checklist, priceFcfa, isArchived, createdAt } }` (200) or 404 `PROCEDURE_NOT_FOUND` —
  Task 15 (edit page) fetches this to pre-fill `ProcedureForm`. `PATCH` accepts a partial
  body and returns the same shape on 200.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/admin/procedures/[id]/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { verifyCsrf } from '@/lib/server/auth';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { GET, PATCH } from './route';
import { seedAdmin, seedProcedure } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}
function makePatch(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockVerifyCsrf.mockReturnValue(null);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/procedures/[id] — detail', () => {
  it('GET returns the full procedure including checklist', async () => {
    const proc = seedProcedure({ id: 'p1' });
    prismaMock.procedure.findUnique.mockResolvedValueOnce(proc as never);

    const res = await GET(makeGet('http://test/api/admin/procedures/p1'), params('p1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { procedure: { checklist: unknown } };
    expect(body.procedure.checklist).toEqual(proc.checklist);
  });

  it('GET returns 404 PROCEDURE_NOT_FOUND for an unknown id', async () => {
    prismaMock.procedure.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeGet('http://test/api/admin/procedures/missing'), params('missing'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROCEDURE_NOT_FOUND');
  });
});

describe('/api/admin/procedures/[id] — edit', () => {
  it('PATCH updates a single field and logs only the field name', async () => {
    const proc = seedProcedure({ id: 'p1' });
    prismaMock.procedure.update.mockResolvedValueOnce({ ...proc, tagline: 'Nouvelle accroche.' } as never);

    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/p1', { tagline: 'Nouvelle accroche.' }),
      params('p1'),
    );
    expect(res.status).toBe(200);

    const updateArgs = prismaMock.procedure.update.mock.calls[0]?.[0];
    const data = updateArgs?.data as Record<string, unknown>;
    expect(data['tagline']).toBe('Nouvelle accroche.');
    expect(data['priceFcfa']).toBeUndefined();
    expect(data['slug']).toBeUndefined();

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'procedure.update',
        targetType: 'Procedure',
        targetId: 'p1',
        metadata: { fields: ['tagline'] },
      }),
    );
  });

  it('PATCH updates isArchived alone (archive toggle)', async () => {
    const proc = seedProcedure({ id: 'p1', isArchived: false });
    prismaMock.procedure.update.mockResolvedValueOnce({ ...proc, isArchived: true } as never);

    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/p1', { isArchived: true }),
      params('p1'),
    );
    expect(res.status).toBe(200);
    const updateArgs = prismaMock.procedure.update.mock.calls[0]?.[0];
    expect((updateArgs?.data as Record<string, unknown>)['isArchived']).toBe(true);
  });

  it('PATCH ignores priceFcfa/slug even if sent — DB value is untouched', async () => {
    const proc = seedProcedure({ id: 'p1', priceFcfa: 5000, slug: 'campus-france' });
    prismaMock.procedure.update.mockResolvedValueOnce(proc as never);

    await PATCH(
      makePatch('http://test/api/admin/procedures/p1', {
        tagline: 'X',
        priceFcfa: 999999,
        slug: 'hacked-slug',
      }),
      params('p1'),
    );

    const updateArgs = prismaMock.procedure.update.mock.calls[0]?.[0];
    const data = updateArgs?.data as Record<string, unknown>;
    expect(data['priceFcfa']).toBeUndefined();
    expect(data['slug']).toBeUndefined();
    expect(data['tagline']).toBe('X');
  });

  it('PATCH with an empty body returns 400', async () => {
    const res = await PATCH(makePatch('http://test/api/admin/procedures/p1', {}), params('p1'));
    expect(res.status).toBe(400);
    expect(prismaMock.procedure.update).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 for an unknown id', async () => {
    prismaMock.procedure.update.mockRejectedValueOnce({ code: 'P2025' });
    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/missing', { tagline: 'X' }),
      params('missing'),
    );
    expect(res.status).toBe(404);
  });

  it('PATCH checks CSRF before requireAdmin', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'CSRF_INVALID' }, { status: 403 }),
    );
    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/p1', { tagline: 'X' }),
      params('p1'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter frontend exec vitest run "src/app/api/admin/procedures/[id]/route.test.ts"
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `frontend/src/app/api/admin/procedures/[id]/route.ts`:

```ts
// Doxi Phase 7 — GET/PATCH /api/admin/procedures/[id]. Detail (full
// checklist) + edit. priceFcfa and slug are intentionally absent from
// PatchBody — Prisma never receives them regardless of what a client
// sends, matching PATCH /api/auth/me's pattern (Phase 6).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { checklistSchema } from '@/lib/server/procedures/checklist';

const PROCEDURE_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  checklist: true,
  priceFcfa: true,
  isArchived: true,
  createdAt: true,
} as const satisfies Prisma.ProcedureSelect;

const PatchBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  field: z.string().trim().min(1).max(100).optional(),
  tagline: z.string().trim().min(1).max(300).optional(),
  checklist: checklistSchema.optional(),
  isArchived: z.boolean().optional(),
});
// No `.refine()` for "at least one field" here — Zod's object parser sets
// every unset `.optional()` shape key to literal `undefined` in its output,
// so `Object.keys(parsed.data)` inside a refine would always return all 6
// keys regardless of what the client actually sent, making that guard a
// no-op. The empty-body check instead runs on the `data` object built below
// from only the keys that are `!== undefined` — same pattern already used
// by PATCH /api/auth/me (frontend/src/app/api/auth/me/route.ts).

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { id },
      select: PROCEDURE_DETAIL_SELECT,
    });
    if (!procedure) {
      return NextResponse.json(
        { error: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    return NextResponse.json({ procedure }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Built via per-field `if (... !== undefined)` assignment, not
    // `...parsed.data` — Zod sets each unset `.optional()` key to literal
    // `undefined` in the parsed object, and exactOptionalPropertyTypes
    // rejects assigning explicit `undefined` to Prisma's optional input
    // fields. This also doubles as the "at least one field" guard: `data`
    // only gains a key when the client actually sent that field. Same
    // pattern as PATCH /api/auth/me (frontend/src/app/api/auth/me/route.ts).
    const data: Prisma.ProcedureUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.country !== undefined) data.country = parsed.data.country;
    if (parsed.data.field !== undefined) data.field = parsed.data.field;
    if (parsed.data.tagline !== undefined) data.tagline = parsed.data.tagline;
    if (parsed.data.checklist !== undefined) {
      data.checklist = parsed.data.checklist as unknown as Prisma.InputJsonValue;
    }
    if (parsed.data.isArchived !== undefined) data.isArchived = parsed.data.isArchived;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'At least one field required' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    let updated;
    try {
      updated = await prisma.procedure.update({
        where: { id },
        data,
        select: PROCEDURE_DETAIL_SELECT,
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2025') {
        return NextResponse.json(
          { error: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
          { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      throw err;
    }

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'procedure.update',
      targetType: 'Procedure',
      targetId: id,
      metadata: { fields: Object.keys(data) },
    });

    return NextResponse.json(
      { procedure: updated },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter frontend exec vitest run "src/app/api/admin/procedures/[id]/route.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/api/admin/procedures/[id]/route.ts" "frontend/src/app/api/admin/procedures/[id]/route.test.ts"
git commit -m "feat(admin): add GET/PATCH /api/admin/procedures/[id] (Phase 7)"
```

---

### Task 8: `frontend/src/app/admin/layout.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/me` (existing route, returns `{ admin: { id, email, role },
  can: string[] }`), `api`/`ApiError` from `@/lib/api`.
- Produces: layout wrapper every page in Tasks 9-16 renders inside.

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/layout.tsx`:

```tsx
// /admin/* layout — gates every admin page behind GET /api/admin/me,
// redirects non-admins to /. Restyled to Doxi tokens (adapted from
// examples/frontend-pages/admin/layout.tsx, which ships unstyled).
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

interface AdminMe {
  admin: { id: string; email: string; role: 'ADMIN' | 'SUPERADMIN' };
}

const NAV = [
  { href: '/admin/users', label: 'Utilisateurs' },
  { href: '/admin/orders', label: 'Commandes' },
  { href: '/admin/procedures', label: 'Procédures' },
  { href: '/admin/audit-log', label: "Journal d'audit" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminMe['admin'] | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<AdminMe>('/api/admin/me');
        if (!cancelled) setAdmin(res.admin);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError) {
            router.replace('/');
          } else {
            router.replace('/');
          }
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked || !admin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50">
        <p className="text-sm text-charcoal-900/60">Vérification des accès…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-paper-50">
      <aside className="w-60 shrink-0 border-r border-ink-900/10 bg-white p-5">
        <h1 className="mb-6 font-serif text-xl text-ink-900">Admin Doxi</h1>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-ink-900 text-paper-50' : 'text-ink-900/80 hover:bg-paper-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="mt-8 text-xs text-charcoal-900/60">
          Connecté en tant que
          <br />
          <span className="font-medium text-ink-900">{admin.email}</span>
          <br />
          <span className="text-charcoal-900/50">{admin.role}</span>
        </p>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

Start `pnpm dev`, log in with a `SUPERADMIN` account (bootstrap one first if needed via
`pnpm db:make-superadmin <email>`), visit `/admin/users` (will 404/blank until Task 9
exists — that's expected at this point; confirm instead that visiting `/admin` as a
non-admin, or logged out, redirects to `/`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/layout.tsx
git commit -m "feat(admin): add /admin layout with access gate (Phase 7)"
```

---

### Task 9: `frontend/src/app/admin/users/page.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/users?q&cursor&limit` (existing route, unchanged this phase).

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/users/page.tsx`:

```tsx
// /admin/users — list with search-by-email/name and cursor "load more".
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Input, Button } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface ListResponse {
  items: AdminUser[];
  nextCursor: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

function roleBadgeVariant(role: AdminUser['role']): 'gold' | 'neutral' {
  return role === 'USER' ? 'neutral' : 'gold';
}

export default function AdminUsersPage() {
  const reduceMotion = useReducedMotion();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/users?${params.toString()}`);
      setUsers((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les utilisateurs.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Utilisateurs</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(true);
          }}
          className="flex gap-2"
        >
          <Input
            type="search"
            placeholder="Email ou nom…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="secondary">
            Rechercher
          </Button>
        </form>
      </header>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && users.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {!loading && users.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucun utilisateur ne correspond.</p>
      )}

      <div className="flex flex-col gap-2">
        {users.map((u, i) => (
          <motion.div
            key={u.id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.25,
              delay: reduceMotion ? 0 : Math.min(i, 10) * 0.02,
              ease: DOXI_EASE,
            }}
          >
            <Link href={`/admin/users/${u.id}`}>
              <Card bordered className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-900">{u.email}</span>
                    <Badge variant={roleBadgeVariant(u.role)}>{u.role}</Badge>
                    {u.status === 'SUSPENDED' && <Badge variant="error">Suspendu</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    {u.name ?? 'Sans nom'} · inscrit le{' '}
                    {new Date(u.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>

      {hasMore && (
        <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, visit `/admin/users` as a `SUPERADMIN`/`ADMIN`. Confirm the list loads,
search filters, "Charger plus" appends more rows when there are 50+.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/users/page.tsx
git commit -m "feat(admin): add /admin/users list page (Phase 7)"
```

---

### Task 10: `frontend/src/app/admin/users/[id]/page.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/users/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/users/[id]` (extended in Task 4 — now returns
  `procedureAccess`/`procedureDocuments`), `GET /api/admin/documents/[documentId]/url`
  (Task 5).

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/users/[id]/page.tsx`:

```tsx
// /admin/users/[id] — user detail: identity/role/status, "Procédures
// achetées" (Phase 7), "Documents" with an on-demand "Voir" button that
// mints a fresh 300s signed URL per click (never prefetched, never cached).
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';

interface AdminUserDetail {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
  procedureAccess: Array<{
    tier: 'SIMPLE' | 'COMPLET';
    grantedAt: string;
    procedure: { id: string; slug: string; name: string };
  }>;
  procedureDocuments: Array<{
    id: string;
    procedureId: string;
    checklistItemId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ user: AdminUserDetail }>(`/api/admin/users/${params.id}`)
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "Impossible de charger l'utilisateur."));
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function viewDocument(documentId: string) {
    setDocError(null);
    setViewingDocId(documentId);
    try {
      const res = await api<{ url: string }>(`/api/admin/documents/${documentId}/url`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setDocError(apiErrorMessage(err, "Impossible d'ouvrir le document."));
    } finally {
      setViewingDocId(null);
    }
  }

  if (error) {
    return <p className="text-sm text-error-600">{error}</p>;
  }

  if (!user) {
    return <p className="text-sm text-charcoal-900/60">Chargement…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-2xl text-ink-900">{user.email}</h1>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={user.role === 'USER' ? 'neutral' : 'gold'}>{user.role}</Badge>
          {user.status === 'SUSPENDED' && <Badge variant="error">Suspendu</Badge>}
        </div>
        <p className="mt-1 text-sm text-charcoal-900/60">
          {user.name ?? 'Sans nom'} · inscrit le{' '}
          {new Date(user.createdAt).toLocaleDateString('fr-FR')}
        </p>
      </header>

      <Card bordered>
        <h2 className="text-lg font-semibold text-ink-900">Procédures achetées</h2>
        {user.procedureAccess.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal-900/60">Aucun achat.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {user.procedureAccess.map((pa) => (
              <div
                key={pa.procedure.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-ink-900/10 p-4"
              >
                <div>
                  <span className="font-medium text-ink-900">{pa.procedure.name}</span>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    Acheté le {new Date(pa.grantedAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <Badge variant={pa.tier === 'COMPLET' ? 'gold' : 'neutral'}>
                  {pa.tier === 'COMPLET' ? 'Complet' : 'Simple'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card bordered>
        <h2 className="text-lg font-semibold text-ink-900">Documents</h2>
        {docError && <p className="mt-3 text-sm text-error-600">{docError}</p>}
        {user.procedureDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal-900/60">Aucun document déposé.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {user.procedureDocuments.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-ink-900/10 p-4"
              >
                <div>
                  <span className="font-medium text-ink-900">{doc.filename}</span>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    {new Date(doc.uploadedAt).toLocaleDateString('fr-FR')} ·{' '}
                    {Math.round(doc.sizeBytes / 1024)} Ko
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={viewingDocId === doc.id}
                  onClick={() => void viewDocument(doc.id)}
                >
                  Voir
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, open a user with at least one purchase and one uploaded document (use the
regular user flow to create fixture data first, or an existing test account). Click
"Voir" and confirm a new tab opens with the signed Cloudinary URL.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/admin/users/[id]/page.tsx"
git commit -m "feat(admin): add user detail page with purchases + documents (Phase 7)"
```

---

### Task 11: `frontend/src/app/admin/orders/page.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/orders/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/orders` (extended in Task 3 — now includes `metadata`),
  `GET /api/admin/procedures?limit=50` (Task 6) for the id→name lookup Map.

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/orders/page.tsx`:

```tsx
// /admin/orders — list-only (no detail page this phase). Resolves
// metadata.procedureId into a readable procedure name via a one-shot
// GET /api/admin/procedures?limit=50 fetch on mount (the catalog is a
// handful of rows — a client-side Map lookup beats a server join).
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';

interface AdminOrder {
  id: string;
  userId: string | null;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' | 'REFUNDED';
  customerEmail: string | null;
  metadata: { tier?: string; procedureId?: string; procedureSlug?: string } | null;
  createdAt: string;
}

interface ListResponse {
  items: AdminOrder[];
  nextCursor: string | null;
}

interface AdminProcedure {
  id: string;
  name: string;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

const STATUS_VARIANT: Record<AdminOrder['status'], 'gold' | 'success' | 'error' | 'neutral'> = {
  PENDING: 'neutral',
  PAID: 'success',
  EXPIRED: 'error',
  FAILED: 'error',
  REFUNDED: 'error',
};

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('fr-FR')} ${currency}`;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [procedureNames, setProcedureNames] = useState<Map<string, string>>(new Map());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: AdminProcedure[] }>('/api/admin/procedures?limit=50')
      .then((res) => {
        setProcedureNames(new Map(res.items.map((p) => [p.id, p.name])));
      })
      .catch(() => {
        // Non-fatal — orders still render, just without a resolved name.
      });
  }, []);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/orders?${params.toString()}`);
      setOrders((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les commandes.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  function procedureLabel(order: AdminOrder): string {
    const procedureId = order.metadata?.procedureId;
    const tier = order.metadata?.tier;
    if (!procedureId) return '—';
    const name = procedureNames.get(procedureId) ?? order.metadata?.procedureSlug ?? procedureId;
    return tier ? `${name} (${tier === 'COMPLET' ? 'Complet' : 'Simple'})` : name;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink-900">Commandes</h1>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && orders.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {!loading && orders.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucune commande.</p>
      )}

      <div className="flex flex-col gap-2">
        {orders.map((o) => (
          <Card key={o.id} bordered className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-900">{procedureLabel(o)}</span>
                <Badge variant={STATUS_VARIANT[o.status]}>{o.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-charcoal-900/60">
                {o.customerEmail ?? o.userId ?? 'Client anonyme'} ·{' '}
                {new Date(o.createdAt).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <span className="font-medium text-ink-900">{formatAmount(o.amount, o.currency)}</span>
          </Card>
        ))}
      </div>

      {hasMore && (
        <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, visit `/admin/orders`, confirm the procedure name + tier resolve correctly
for at least one real order (create one via the normal purchase flow if none exist).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/orders/page.tsx
git commit -m "feat(admin): add /admin/orders list page (Phase 7)"
```

---

### Task 12: `frontend/src/app/admin/procedures/page.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/procedures/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/procedures` (Task 6), `PATCH /api/admin/procedures/[id]`
  (Task 7, for the archive/unarchive toggle).

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/procedures/page.tsx`:

```tsx
// /admin/procedures — catalog list with an inline archive/unarchive toggle
// (reversible, no confirmation dialog needed) and a link to create a new one.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Button, Toggle } from '@/components/ui';

interface AdminProcedure {
  id: string;
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  isArchived: boolean;
  createdAt: string;
}

interface ListResponse {
  items: AdminProcedure[];
  nextCursor: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function AdminProceduresPage() {
  const [procedures, setProcedures] = useState<AdminProcedure[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/procedures?${params.toString()}`);
      setProcedures((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les procédures.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  async function toggleArchive(procedure: AdminProcedure) {
    setTogglingId(procedure.id);
    setError(null);
    try {
      await api(`/api/admin/procedures/${procedure.id}`, {
        method: 'PATCH',
        body: { isArchived: !procedure.isArchived },
      });
      setProcedures((prev) =>
        prev.map((p) => (p.id === procedure.id ? { ...p, isArchived: !p.isArchived } : p)),
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de modifier le statut.'));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Procédures</h1>
        <Link href="/admin/procedures/new">
          <Button>Nouvelle procédure</Button>
        </Link>
      </header>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && procedures.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      <div className="flex flex-col gap-2">
        {procedures.map((p) => (
          <Card key={p.id} bordered className="flex items-center justify-between gap-3 p-4">
            <Link href={`/admin/procedures/${p.id}`} className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-900">{p.name}</span>
                {p.isArchived && <Badge variant="error">Archivée</Badge>}
              </div>
              <p className="mt-1 text-sm text-charcoal-900/60">
                {p.country}
                {p.field ? ` · ${p.field}` : ''}
              </p>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-xs text-charcoal-900/60">
                {p.isArchived ? 'Archivée' : 'Publiée'}
              </span>
              <Toggle
                checked={!p.isArchived}
                onChange={() => void toggleArchive(p)}
                disabled={togglingId === p.id}
                label={p.isArchived ? 'Désarchiver' : 'Archiver'}
              />
            </div>
          </Card>
        ))}
      </div>

      {!loading && procedures.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucune procédure pour le moment.</p>
      )}

      {hasMore && (
        <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, visit `/admin/procedures`, toggle archive on a test procedure, confirm the
badge appears/disappears and `GET /api/procedures` (public) no longer lists it while
archived.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/procedures/page.tsx
git commit -m "feat(admin): add /admin/procedures list page with archive toggle (Phase 7)"
```

---

### Task 13: `frontend/src/components/admin/ProcedureForm.tsx` (new, shared)

**Files:**
- Create: `frontend/src/components/admin/ProcedureForm.tsx`

**Interfaces:**
- Produces: `ProcedureFormValues` type and `ProcedureForm` component — Tasks 14 and 15
  both import these. `ProcedureForm` takes `initialValues?: ProcedureFormValues`,
  `submitLabel: string`, `onSubmit: (values: ProcedureFormValues) => Promise<void>`, and
  an optional `error: string | null` to render a top-level submit error.

- [ ] **Step 1: Implement**

Create `frontend/src/components/admin/ProcedureForm.tsx`:

```tsx
// Shared create/edit form for admin/procedures/new and admin/procedures/[id].
// Does NOT import @/lib/server/slug (server-only) — reimplements a small
// client-side slugify purely as a UX suggestion for each checklist item's
// `id`; the id stays freely editable and is never sent as the procedure's
// own slug (that's derived server-side in POST /api/admin/procedures).
'use client';

import { useState, type FormEvent } from 'react';
import { Card, Input, Button } from '@/components/ui';

export interface ChecklistItemDraft {
  key: string; // client-only React key, stable across edits
  id: string;
  title: string;
  description: string;
  autoId: boolean; // true until the user manually edits `id`
}

export interface ProcedureFormValues {
  name: string;
  country: string;
  field: string;
  tagline: string;
  checklist: Array<{ id: string; title: string; description?: string }>;
}

interface ProcedureFormProps {
  initialValues?: ProcedureFormValues;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: ProcedureFormValues) => Promise<void>;
}

function clientSlugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `item_${keySeq}`;
}

function draftsFromInitial(initial?: ProcedureFormValues): ChecklistItemDraft[] {
  if (!initial || initial.checklist.length === 0) {
    return [{ key: nextKey(), id: '', title: '', description: '', autoId: true }];
  }
  return initial.checklist.map((item) => ({
    key: nextKey(),
    id: item.id,
    title: item.title,
    description: item.description ?? '',
    autoId: false,
  }));
}

export function ProcedureForm({
  initialValues,
  submitLabel,
  submitting,
  error,
  onSubmit,
}: ProcedureFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [country, setCountry] = useState(initialValues?.country ?? '');
  const [field, setField] = useState(initialValues?.field ?? '');
  const [tagline, setTagline] = useState(initialValues?.tagline ?? '');
  const [items, setItems] = useState<ChecklistItemDraft[]>(() => draftsFromInitial(initialValues));
  const [formError, setFormError] = useState<string | null>(null);

  function updateItem(key: string, patch: Partial<ChecklistItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function onTitleChange(key: string, title: string) {
    setItems((prev) =>
      prev.map((it) =>
        it.key === key ? { ...it, title, id: it.autoId ? clientSlugify(title) : it.id } : it,
      ),
    );
  }

  function onIdChange(key: string, id: string) {
    updateItem(key, { id, autoId: false });
  }

  function addItem() {
    setItems((prev) => [...prev, { key: nextKey(), id: '', title: '', description: '', autoId: true }]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (name.trim().length === 0 || country.trim().length === 0 || tagline.trim().length === 0) {
      setFormError('Nom, pays et accroche sont obligatoires.');
      return;
    }
    if (items.length === 0) {
      setFormError('Ajoute au moins un élément de checklist.');
      return;
    }
    for (const item of items) {
      if (item.id.trim().length === 0 || item.title.trim().length === 0) {
        setFormError('Chaque élément de checklist doit avoir un identifiant et un titre.');
        return;
      }
    }
    const ids = items.map((it) => it.id.trim());
    if (new Set(ids).size !== ids.length) {
      setFormError('Les identifiants de checklist doivent être uniques.');
      return;
    }

    await onSubmit({
      name: name.trim(),
      country: country.trim(),
      field: field.trim(),
      tagline: tagline.trim(),
      checklist: items.map((it) => ({
        id: it.id.trim(),
        title: it.title.trim(),
        ...(it.description.trim() ? { description: it.description.trim() } : {}),
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card bordered className="flex flex-col gap-4">
        <Input label="Nom" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus France" />
        <Input label="Pays" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="France" />
        <Input
          label="Domaine (optionnel)"
          value={field}
          onChange={(e) => setField(e.target.value)}
          placeholder="Master"
        />
        <Input
          label="Accroche"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Étudie en France via Campus France."
        />
      </Card>

      <Card bordered className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">Checklist</h2>
          <Button type="button" variant="secondary" size="sm" onClick={addItem}>
            Ajouter un élément
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.key} className="rounded-xl border border-ink-900/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  label="Titre"
                  value={item.title}
                  onChange={(e) => onTitleChange(item.key, e.target.value)}
                  placeholder="Copie du passeport"
                  className="flex-1"
                />
                <Input
                  label="Identifiant"
                  value={item.id}
                  onChange={(e) => onIdChange(item.key, e.target.value)}
                  placeholder="passport"
                  helperText="Ne change pas cet identifiant après publication."
                  className="sm:w-48"
                />
              </div>
              <Input
                label="Description (optionnelle)"
                value={item.description}
                onChange={(e) => updateItem(item.key, { description: e.target.value })}
                className="mt-3"
              />
              <div className="mt-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.key)}>
                  Supprimer
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {(formError ?? error) && (
        <p role="alert" className="text-sm text-error-600">
          {formError ?? error}
        </p>
      )}

      <div>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/ProcedureForm.tsx
git commit -m "feat(admin): add shared ProcedureForm component (Phase 7)"
```

---

### Task 14: `frontend/src/app/admin/procedures/new/page.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/procedures/new/page.tsx`

**Interfaces:**
- Consumes: `ProcedureForm`/`ProcedureFormValues` (Task 13), `POST /api/admin/procedures`
  (Task 6).

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/procedures/new/page.tsx`:

```tsx
// /admin/procedures/new — create form, POSTs and redirects to the new
// procedure's detail page on success.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ProcedureForm, type ProcedureFormValues } from '@/components/admin/ProcedureForm';

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function NewProcedurePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: ProcedureFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ procedure: { id: string } }>('/api/admin/procedures', {
        method: 'POST',
        body: values,
      });
      router.push(`/admin/procedures/${res.procedure.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de créer la procédure.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink-900">Nouvelle procédure</h1>
      <ProcedureForm
        submitLabel="Créer"
        submitting={submitting}
        error={error}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, `/admin/procedures/new`, create a procedure with a 2-item checklist, confirm
redirect to its detail page and appearance in `/admin/procedures`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/procedures/new/page.tsx
git commit -m "feat(admin): add procedure creation page (Phase 7)"
```

---

### Task 15: `frontend/src/app/admin/procedures/[id]/page.tsx` (new)

**Files:**
- Create: `frontend/src/app/admin/procedures/[id]/page.tsx`

**Interfaces:**
- Consumes: `ProcedureForm`/`ProcedureFormValues` (Task 13), `GET`/`PATCH
  /api/admin/procedures/[id]` (Task 7).

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/procedures/[id]/page.tsx`:

```tsx
// /admin/procedures/[id] — edit form, pre-filled from GET, PATCHes on submit.
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ProcedureForm, type ProcedureFormValues } from '@/components/admin/ProcedureForm';

interface AdminProcedureDetail {
  id: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  checklist: Array<{ id: string; title: string; description?: string }>;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function EditProcedurePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [procedure, setProcedure] = useState<AdminProcedureDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ procedure: AdminProcedureDetail }>(`/api/admin/procedures/${params.id}`)
      .then((res) => {
        if (!cancelled) setProcedure(res.procedure);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessage(err, 'Impossible de charger la procédure.'));
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleSubmit(values: ProcedureFormValues) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api(`/api/admin/procedures/${params.id}`, { method: 'PATCH', body: values });
      router.push('/admin/procedures');
    } catch (err) {
      setSubmitError(apiErrorMessage(err, 'Impossible de mettre à jour la procédure.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <p className="text-sm text-error-600">{loadError}</p>;
  }
  if (!procedure) {
    return <p className="text-sm text-charcoal-900/60">Chargement…</p>;
  }

  const initialValues: ProcedureFormValues = {
    name: procedure.name,
    country: procedure.country,
    field: procedure.field ?? '',
    tagline: procedure.tagline,
    checklist: procedure.checklist,
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink-900">Modifier : {procedure.name}</h1>
      <ProcedureForm
        initialValues={initialValues}
        submitLabel="Enregistrer"
        submitting={submitting}
        error={submitError}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, open a procedure from `/admin/procedures`, edit a field, save, confirm it
persists (reload the page and see the new value).

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/admin/procedures/[id]/page.tsx"
git commit -m "feat(admin): add procedure edit page (Phase 7)"
```

---

### Task 16: `frontend/src/app/admin/audit-log/page.tsx` (new) + final verification

**Files:**
- Create: `frontend/src/app/admin/audit-log/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/audit-log?action&targetType&cursor&limit` (existing route,
  unchanged this phase — see `frontend/src/app/api/admin/audit-log/route.ts` for the
  supported query params).

- [ ] **Step 1: Implement**

Create `frontend/src/app/admin/audit-log/page.tsx`:

```tsx
// /admin/audit-log — paginated AdminAction list with an action/targetType
// filter bar. The route already existed (D-AUDIT-01) but had zero UI
// consumer before this phase.
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Input, Button } from '@/components/ui';

interface AdminActionRow {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

interface ListResponse {
  items: AdminActionRow[];
  nextCursor: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function AdminAuditLogPage() {
  const [rows, setRows] = useState<AdminActionRow[]>([]);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (targetType) params.set('targetType', targetType);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/audit-log?${params.toString()}`);
      setRows((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de charger le journal d'audit."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Journal d'audit</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(true);
          }}
          className="flex flex-wrap gap-2"
        >
          <Input
            placeholder="Action (ex. procedure.update)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-56"
          />
          <Input
            placeholder="Type de cible (ex. Procedure)"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-48"
          />
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
        </form>
      </header>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && rows.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucune entrée.</p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <Card key={row.id} bordered className="flex flex-col gap-1 p-4">
            <div className="flex items-center gap-2">
              <Badge variant="neutral">{row.action}</Badge>
              {row.targetType && (
                <span className="text-xs text-charcoal-900/60">
                  {row.targetType}
                  {row.targetId ? ` · ${row.targetId}` : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-charcoal-900/50">
              {new Date(row.createdAt).toLocaleString('fr-FR')} · acteur {row.actorId}
            </p>
          </Card>
        ))}
      </div>

      {hasMore && (
        <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

`pnpm dev`, visit `/admin/audit-log`, confirm the `procedure.create`/`procedure.update`/
`document.view` entries generated by earlier manual checks in Tasks 5-15 appear, and the
action/targetType filters narrow the list.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/audit-log/page.tsx
git commit -m "feat(admin): add /admin/audit-log page (Phase 7)"
```

- [ ] **Step 4: Full verification pass**

Run in order from `frontend/`:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm build
```

Expected: typecheck clean, full test suite green, build succeeds with `/admin/*` routes
present in the build output (check the build's route list for `/admin/users`,
`/admin/users/[id]`, `/admin/orders`, `/admin/procedures`, `/admin/procedures/new`,
`/admin/procedures/[id]`, `/admin/audit-log`).

- [ ] **Step 5: Manual smoke test (full flow)**

`pnpm dev`, logged in as a `SUPERADMIN` (bootstrap via `pnpm db:make-superadmin <email>`
if needed):

1. `/admin/users` → open a user with a purchase → click "Voir" on a document → opens in
   a new tab with a valid signed URL.
2. `/admin/procedures` → "Nouvelle procédure" → create with a 2-item checklist →
   redirects to its detail page.
3. Edit a field on that procedure's detail page → save → reload → change persisted.
4. Archive it from `/admin/procedures` → badge appears → confirm `GET /api/procedures`
   (public catalog) no longer lists it.
5. Unarchive it → badge disappears → confirm it reappears in the public catalog.
6. `/admin/orders` → confirm at least one order shows a resolved procedure name + tier.
7. `/admin/audit-log` → confirm entries for `procedure.create`, `procedure.update`,
   `document.view` all appear with correct `actorId`/`targetId`.

- [ ] **Step 6: Format + lint**

```bash
pnpm format && pnpm lint
```

Expected: clean (project's standard pre-commit gate per `CLAUDE.md`).

- [ ] **Step 7: Final commit if formatting touched files**

```bash
git add -A
git commit -m "chore: format Phase 7 admin back-office files"
```

(Skip this step if `pnpm format` made no changes.)
