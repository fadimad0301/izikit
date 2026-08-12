# Doxi Phase 6: Compte + statut dossiers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `/settings` to Doxi's design tokens, make the user's name and phone
editable, and add a "Mes procédures" section showing purchase/document status per
procedure (including the first real dossier-status use of the `Stamp` component).

**Architecture:** One new nullable `User.phone` column; `GET /api/auth/me` extended to
return `name`/`avatarUrl`/`phone`; a new `PATCH /api/auth/me` for editing them; a new
`GET /api/procedures/mine` that joins `ProcedureAccess` to `Procedure` and
`ProcedureDocument` to compute per-purchase status; `/settings` rewritten to consume
both.

**Tech Stack:** Next.js 16 App Router Route Handlers, Prisma 5 + Neon, Zod, Vitest +
vitest-mock-extended, Tailwind v4 + existing Doxi design tokens, framer-motion.

## Global Constraints

- Every Route Handler exports `export const runtime = 'nodejs'`.
- Mutating routes verify CSRF (`verifyCsrf(req)`) BEFORE `requireAuth`, exactly as
  `frontend/src/app/api/auth/change-password/route.ts` does.
- Zod validation failures return `{ error: 'VALIDATION_FAILED', message }` — the
  established generic code across every `/api/auth/*` route (do not invent new codes
  like `INVALID_PHONE`).
- Phone format is validated via the existing `zPhone` helper in
  `frontend/src/lib/server/zod-helpers.ts` (PROTECTED — import only, never modify). It
  strips spaces/dashes/parens then requires E.164: `^\+\d{8,15}$`.
- `name` is never cleared to empty (it's used on the generated CV) — only `phone` can be
  cleared, via an explicit `phone: ""` in the request body, which the route maps to
  `null`.
- No SMS/OTP phone verification. No new Prisma models — only one new nullable column on
  `User`.
- `GET /api/procedures/mine` must not fail closed on one malformed procedure's
  checklist — it skips that item (with `log.warn`) and still returns the user's other
  purchases. This intentionally diverges from `GET /api/procedures/[slug]`, which 500s
  because the whole page IS that one procedure.
- No test file for the `/settings` page component — matches the existing convention
  (zero page-component tests anywhere in the app, e.g. `/procedures/[slug]/page.tsx`).
- French, tutoiement copy throughout, matching every other Doxi-facing string in the app.

---

### Task 1: Prisma schema — `User.phone`

**Files:**
- Modify: `frontend/prisma/schema.prisma`
- Create: migration under `frontend/prisma/migrations/` (name via CLI, see Step 2)

**Interfaces:**
- Produces: `User.phone: String?` (nullable, no default). Task 2 selects/updates it;
  Task 3 does not touch it.

- [ ] **Step 1: Add the `phone` field to `User`**

Open `frontend/prisma/schema.prisma`. Find the `avatarUrl` field on the `User` model
(it currently reads):

```prisma
  // Optional avatar URL — populated from OAuth profile on first sign-in.
  avatarUrl         String?
```

Add the new field directly after it:

```prisma
  // Optional avatar URL — populated from OAuth profile on first sign-in.
  avatarUrl         String?
  // Optional contact phone, E.164 (e.g. "+221771234567"). Validated by
  // zPhone at the API layer (frontend/src/lib/server/zod-helpers.ts), not
  // enforced in the DB. No SMS/OTP verification — contact info only.
  phone             String?
```

- [ ] **Step 2: Kill any stale dev server before migrating (Windows file-lock)**

Prisma Client regeneration fails silently if a `next dev` process holds a lock on
`query_engine-windows.dll.node`. Stop any running dev server before continuing.

- [ ] **Step 3: Run the migration**

```bash
cd frontend
pnpm db:migrate:dev -- --name doxi_user_phone
```

Expected: Prisma creates a new folder under `frontend/prisma/migrations/`, applies it to
the dev database, and regenerates the Prisma Client. Confirm the migration file contains
`ALTER TABLE "User" ADD COLUMN "phone" TEXT`.

- [ ] **Step 4: Verify the generated Prisma Client**

```bash
cd frontend
pnpm exec tsc --noEmit
```

Expected: no errors. This confirms `prisma.user.select({ phone: true })` and
`prisma.user.update({ data: { phone } })` are now visible to TypeScript.

- [ ] **Step 5: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(db): add User.phone (Phase 6)"
```

---

### Task 2: `GET`/`PATCH /api/auth/me` — profile fields

**Files:**
- Modify: `frontend/src/app/api/auth/me/route.ts`
- Modify: `frontend/src/app/api/auth/me/route.test.ts`
- Modify: `frontend/src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `User.phone` (Task 1), `zPhone` from `frontend/src/lib/server/zod-helpers.ts`
  (existing, protected), `verifyCsrf` from `frontend/src/lib/server/auth.ts` (existing,
  protected), `requireAuth` from `frontend/src/lib/server/middleware` (existing,
  protected).
- Produces: `GET /api/auth/me` response gains `user.name: string | null`,
  `user.avatarUrl: string | null`, `user.phone: string | null`. New
  `PATCH /api/auth/me` accepting `{ name?: string, phone?: string }`, returning
  `{ name: string | null, phone: string | null }` on 200. The `AuthContext` `User`
  interface gains the same three fields — Task 4 consumes `user.name` and `user.phone`
  from `useUser()`.

- [ ] **Step 1: Extend the `GET` handler's select and response shape**

Open `frontend/src/app/api/auth/me/route.ts`. Find the `prisma.user.findUnique` call's
`select` block:

```ts
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: true,
        oauthAccounts: { select: { provider: true } },
      },
```

Add three fields:

```ts
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        phone: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: true,
        oauthAccounts: { select: { provider: true } },
      },
```

Find the `const user = {` object literal and add the same three fields (right after
`email: dbUser?.email ?? auth.user.email,`):

```ts
      email: dbUser?.email ?? auth.user.email,
      name: dbUser?.name ?? null,
      avatarUrl: dbUser?.avatarUrl ?? null,
      phone: dbUser?.phone ?? null,
```

- [ ] **Step 2: Update the existing GET test to cover the new fields**

Open `frontend/src/app/api/auth/me/route.test.ts`. In `'Test 1: authed — returns user
identity'`, the `prismaMock.user.findUnique.mockResolvedValue` call currently returns
`{ id: 'u1', email: 'a@b.com', tokenVersion: 0 }`. Change it to:

```ts
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
      name: 'Awa Diop',
      avatarUrl: null,
      phone: '+221771234567',
    } as never);
```

And change the assertion right below from:

```ts
    expect(await res.json()).toMatchObject({
      user: { sub: 'u1', email: 'a@b.com' },
    });
```

to:

```ts
    expect(await res.json()).toMatchObject({
      user: { sub: 'u1', email: 'a@b.com', name: 'Awa Diop', avatarUrl: null, phone: '+221771234567' },
    });
```

- [ ] **Step 3: Run the test to confirm it still passes**

```bash
cd frontend
pnpm exec vitest run src/app/api/auth/me/route.test.ts -t "Test 1"
```

Expected: PASS.

- [ ] **Step 4: Add imports needed by the new `PATCH` handler**

At the top of `frontend/src/app/api/auth/me/route.ts`, the current imports are:

```ts
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
```

Add four more:

```ts
import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { verifyCsrf } from '@/lib/server/auth';
import { zPhone } from '@/lib/server/zod-helpers';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
```

- [ ] **Step 5: Write the failing PATCH tests**

Append to `frontend/src/app/api/auth/me/route.test.ts`, after the closing `});` of the
existing `describe('GET /api/auth/me', ...)` block:

```ts
function makePatchReq(opts: {
  body?: unknown;
  bearer?: string;
  csrf?: boolean;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.csrf !== false) {
    headers['x-csrf-token'] = 'csrf-token';
    headers.cookie = 'app-csrf=csrf-token';
  }
  return new NextRequest('https://test/api/auth/me', {
    method: 'PATCH',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe('PATCH /api/auth/me', () => {
  beforeEach(() => {
    __cookieStore.clear();
    vi.mocked(verifyToken).mockReset();
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'u1', email: 'a@b.com', tokenVersion: 0 });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
  });

  it('Test 1: missing CSRF header — 403', async () => {
    const res = await PATCH(
      makePatchReq({ body: { name: 'Awa' }, bearer: 'valid', csrf: false }),
    );
    expect(res.status).toBe(403);
  });

  it('Test 2: no auth — 401', async () => {
    const res = await PATCH(makePatchReq({ body: { name: 'Awa' } }));
    expect(res.status).toBe(401);
  });

  it('Test 3: updates name only', async () => {
    prismaMock.user.update.mockResolvedValue({ name: 'Awa Diop', phone: null } as never);
    const res = await PATCH(makePatchReq({ body: { name: 'Awa Diop' }, bearer: 'valid' }));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Awa Diop' },
      select: { id: true, name: true, phone: true },
    });
    expect(await res.json()).toEqual({ name: 'Awa Diop', phone: null });
  });

  it('Test 4: updates phone only', async () => {
    prismaMock.user.update.mockResolvedValue({ name: null, phone: '+221771234567' } as never);
    const res = await PATCH(
      makePatchReq({ body: { phone: '+221 77 123 45 67' }, bearer: 'valid' }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { phone: '+221771234567' },
      select: { id: true, name: true, phone: true },
    });
  });

  it('Test 5: updates name and phone together', async () => {
    prismaMock.user.update.mockResolvedValue({ name: 'Awa', phone: '+221771234567' } as never);
    const res = await PATCH(
      makePatchReq({ body: { name: 'Awa', phone: '+221771234567' }, bearer: 'valid' }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Awa', phone: '+221771234567' },
      select: { id: true, name: true, phone: true },
    });
  });

  it('Test 6: clears phone with an empty string', async () => {
    prismaMock.user.update.mockResolvedValue({ name: null, phone: null } as never);
    const res = await PATCH(makePatchReq({ body: { phone: '' }, bearer: 'valid' }));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { phone: null },
      select: { id: true, name: true, phone: true },
    });
  });

  it('Test 7: empty name — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: { name: '' }, bearer: 'valid' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('Test 8: name over 100 chars — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(
      makePatchReq({ body: { name: 'a'.repeat(101) }, bearer: 'valid' }),
    );
    expect(res.status).toBe(400);
  });

  it('Test 9: malformed phone — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: { phone: 'not-a-phone' }, bearer: 'valid' }));
    expect(res.status).toBe(400);
  });

  it('Test 10: empty body — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: {}, bearer: 'valid' }));
    expect(res.status).toBe(400);
  });
});
```

Add `PATCH` to the existing `import { GET } from './route';` line, making it
`import { GET, PATCH } from './route';`.

- [ ] **Step 6: Run the tests to verify they fail**

```bash
cd frontend
pnpm exec vitest run src/app/api/auth/me/route.test.ts
```

Expected: FAIL — `PATCH` is not exported from `./route` yet.

- [ ] **Step 7: Implement the `PATCH` handler**

Append to `frontend/src/app/api/auth/me/route.ts`, after the closing `}` of the existing
`GET` function:

```ts
const PatchMeBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.union([zPhone, z.literal('')]).optional(),
});

function jsonError(code: string, status: number, requestId: string, message?: string): NextResponse {
  const res = NextResponse.json({ error: code, ...(message ? { message } : {}) }, { status });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) {
      csrfFail.headers.set('x-request-id', ctx.requestId);
      return csrfFail;
    }

    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) {
      auth.headers.set('x-request-id', ctx.requestId);
      return auth;
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Corps de requête invalide.');
    }

    const parsed = PatchMeBody.safeParse(raw);
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Champs invalides.');
    }

    const data: Prisma.UserUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.phone !== undefined) {
      data.phone = parsed.data.phone === '' ? null : parsed.data.phone;
    }
    if (Object.keys(data).length === 0) {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Aucun champ à mettre à jour.');
    }

    const updated = await prisma.user.update({
      where: { id: auth.user.sub },
      data,
      select: { id: true, name: true, phone: true },
    });

    return NextResponse.json(
      { name: updated.name, phone: updated.phone },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd frontend
pnpm exec vitest run src/app/api/auth/me/route.test.ts
```

Expected: PASS, all tests in both `describe` blocks.

- [ ] **Step 9: Extend the `AuthContext` `User` type**

Open `frontend/src/contexts/AuthContext.tsx`. Find the `User` interface:

```ts
export interface User {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** false when the account was created via OAuth and never set a password. */
  hasPassword: boolean;
  /** Provider names already linked, e.g. ['google']. Empty for pure email/password accounts. */
  linkedProviders: string[];
}
```

Add three fields:

```ts
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** false when the account was created via OAuth and never set a password. */
  hasPassword: boolean;
  /** Provider names already linked, e.g. ['google']. Empty for pure email/password accounts. */
  linkedProviders: string[];
}
```

- [ ] **Step 10: Full typecheck**

```bash
cd frontend
pnpm exec tsc --noEmit
```

Expected: no errors — confirms every existing `useUser()`/`useAuth()` consumer still
compiles with the widened `User` type.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/app/api/auth/me/route.ts frontend/src/app/api/auth/me/route.test.ts frontend/src/contexts/AuthContext.tsx
git commit -m "feat(auth): add PATCH /api/auth/me for name/phone (Phase 6)"
```

---

### Task 3: `GET /api/procedures/mine`

**Files:**
- Create: `frontend/src/app/api/procedures/mine/route.ts`
- Create: `frontend/src/app/api/procedures/mine/route.test.ts`

**Interfaces:**
- Consumes: `checklistSchema` from `frontend/src/lib/server/procedures/checklist.ts`
  (existing, Phase 5), `requireAuth` from `frontend/src/lib/server/middleware`
  (existing, protected).
- Produces: `GET /api/procedures/mine` → `200` with an array of
  `{ slug: string, name: string, country: string, field: string | null, tier: 'SIMPLE' | 'COMPLET', checklistTotal: number, documentsUploaded: number | null, grantedAt: string }`,
  sorted by `grantedAt` descending. Task 4 consumes this exact shape (naming it
  `MyProcedure` client-side).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/api/procedures/mine/route.test.ts`:

```ts
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);

function makeReq(): NextRequest {
  return new NextRequest('http://test/api/procedures/mine', { method: 'GET' });
}

const AUTHED = { user: { sub: 'user-1', email: 'me@example.com' } };

const CHECKLIST_2_ITEMS = [
  { id: 'passeport-valide', title: 'Passeport en cours de validité' },
  { id: 'lettre-motivation', title: 'Lettre de motivation' },
];

describe('GET /api/procedures/mine', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(AUTHED as never);
  });

  it('Test 1: not authenticated — 401', async () => {
    mockRequireAuth.mockResolvedValue(new NextResponse(null, { status: 401 }) as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('Test 2: no purchases — empty array', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([]);
    prismaMock.procedureDocument.groupBy.mockResolvedValue([] as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('Test 3: SIMPLE tier — documentsUploaded is null', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'SIMPLE',
        grantedAt: new Date('2026-08-01T00:00:00.000Z'),
        procedureId: 'proc_1',
        procedure: {
          slug: 'campus-france',
          name: 'Campus France',
          country: 'France',
          field: null,
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    prismaMock.procedureDocument.groupBy.mockResolvedValue([] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual([
      {
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tier: 'SIMPLE',
        checklistTotal: 2,
        documentsUploaded: null,
        grantedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('Test 4: COMPLET tier, partial uploads', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'COMPLET',
        grantedAt: new Date('2026-08-02T00:00:00.000Z'),
        procedureId: 'proc_2',
        procedure: {
          slug: 'chevening',
          name: 'Chevening',
          country: 'Royaume-Uni',
          field: 'Master',
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    prismaMock.procedureDocument.groupBy.mockResolvedValue([
      { procedureId: 'proc_2', _count: { _all: 1 } },
    ] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body[0]).toMatchObject({
      tier: 'COMPLET',
      checklistTotal: 2,
      documentsUploaded: 1,
    });
  });

  it('Test 5: COMPLET tier, all documents uploaded', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'COMPLET',
        grantedAt: new Date('2026-08-03T00:00:00.000Z'),
        procedureId: 'proc_3',
        procedure: {
          slug: 'bourse-canada',
          name: 'Bourse Canada',
          country: 'Canada',
          field: null,
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    prismaMock.procedureDocument.groupBy.mockResolvedValue([
      { procedureId: 'proc_3', _count: { _all: 2 } },
    ] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body[0]).toMatchObject({ documentsUploaded: 2, checklistTotal: 2 });
  });

  it('Test 6: malformed checklist is skipped, other purchases still returned', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'SIMPLE',
        grantedAt: new Date('2026-08-04T00:00:00.000Z'),
        procedureId: 'proc_bad',
        procedure: {
          slug: 'broken',
          name: 'Broken',
          country: 'X',
          field: null,
          checklist: 'not-an-array',
        },
      },
      {
        tier: 'SIMPLE',
        grantedAt: new Date('2026-08-01T00:00:00.000Z'),
        procedureId: 'proc_ok',
        procedure: {
          slug: 'campus-france',
          name: 'Campus France',
          country: 'France',
          field: null,
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    prismaMock.procedureDocument.groupBy.mockResolvedValue([] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe('campus-france');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend
pnpm exec vitest run src/app/api/procedures/mine/route.test.ts
```

Expected: FAIL — `frontend/src/app/api/procedures/mine/route.ts` does not exist yet.

- [ ] **Step 3: Implement the route**

Create `frontend/src/app/api/procedures/mine/route.ts`:

```ts
// Doxi Phase 6 — GET /api/procedures/mine. Lists the authenticated user's purchased
// procedures with their tier and (for COMPLET) document-upload progress, for the
// "Mes procédures" section of /settings.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import { checklistSchema } from '@/lib/server/procedures/checklist';

interface MyProcedure {
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tier: 'SIMPLE' | 'COMPLET';
  checklistTotal: number;
  documentsUploaded: number | null;
  grantedAt: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) {
      auth.headers.set('x-request-id', ctx.requestId);
      return auth;
    }

    const accesses = await prisma.procedureAccess.findMany({
      where: { userId: auth.user.sub },
      orderBy: { grantedAt: 'desc' },
      select: {
        tier: true,
        grantedAt: true,
        procedureId: true,
        procedure: {
          select: { slug: true, name: true, country: true, field: true, checklist: true },
        },
      },
    });

    const completIds = accesses.filter((a) => a.tier === 'COMPLET').map((a) => a.procedureId);
    const counts =
      completIds.length > 0
        ? await prisma.procedureDocument.groupBy({
            by: ['procedureId'],
            where: { userId: auth.user.sub, procedureId: { in: completIds } },
            _count: { _all: true },
          })
        : [];
    const uploadedByProcedureId = new Map(counts.map((c) => [c.procedureId, c._count._all]));

    const result: MyProcedure[] = [];
    for (const access of accesses) {
      const parsedChecklist = checklistSchema.safeParse(access.procedure.checklist);
      if (!parsedChecklist.success) {
        log.warn('procedure checklist failed to validate — skipped from /mine list', {
          procedureId: access.procedureId,
          slug: access.procedure.slug,
        });
        continue;
      }
      const tier = access.tier as 'SIMPLE' | 'COMPLET';
      result.push({
        slug: access.procedure.slug,
        name: access.procedure.name,
        country: access.procedure.country,
        field: access.procedure.field,
        tier,
        checklistTotal: parsedChecklist.data.length,
        documentsUploaded:
          tier === 'COMPLET' ? (uploadedByProcedureId.get(access.procedureId) ?? 0) : null,
        grantedAt: access.grantedAt.toISOString(),
      });
    }

    return NextResponse.json(result, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend
pnpm exec vitest run src/app/api/procedures/mine/route.test.ts
```

Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/procedures/mine/route.ts frontend/src/app/api/procedures/mine/route.test.ts
git commit -m "feat(procedures): add GET /api/procedures/mine (Phase 6)"
```

---

### Task 4: `/settings` — restyle + profile form + dossier status

**Files:**
- Modify: `frontend/src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `user.name`, `user.avatarUrl`, `user.phone` from `useUser()` (Task 2);
  `PATCH /api/auth/me` (Task 2); `GET /api/procedures/mine` → `MyProcedure[]` (Task 3);
  `Card`, `Badge`, `Input`, `Button`, `Stamp` from `@/components/ui`; `useReducedMotion`,
  `DOXI_EASE` from `@/lib/motion`.
- Produces: nothing consumed by a later task (final task in this plan).

- [ ] **Step 1: Replace the full file with the restyled version**

This task has no separate test file (see Global Constraints — no page-component tests
exist in this project). Replace the entire content of
`frontend/src/app/settings/page.tsx` with:

```tsx
// /settings — compte : profil, mot de passe, comptes liés, statut des procédures.
//
// Trois flux existants (inchangés en logique, restylés en Phase 6) :
//   1. Set / change password — voir onSubmitPassword.
//   2. Lier Google — voir la section "Comptes liés".
// Deux flux ajoutés en Phase 6 :
//   3. Éditer nom + téléphone (PATCH /api/auth/me).
//   4. Statut des procédures achetées (GET /api/procedures/mine), avec un Stamp
//      "Dossier complet" quand tous les documents d'une procédure Complet sont déposés.
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Badge, Input, Button, Stamp } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

interface MyProcedure {
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tier: 'SIMPLE' | 'COMPLET';
  checklistTotal: number;
  documentsUploaded: number | null;
  grantedAt: string;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function SettingsPage() {
  const user = useUser();
  const { refresh } = useAuth();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

  // Profile form state.
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password form state.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Mes procédures" state.
  const [procedures, setProcedures] = useState<MyProcedure[] | null>(null);
  const [proceduresError, setProceduresError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setProfileName(user.name ?? '');
      setProfilePhone(user.phone ?? '');
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api<MyProcedure[]>('/api/procedures/mine')
      .then((data) => {
        if (!cancelled) setProcedures(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setProceduresError(apiErrorMessage(err, 'Impossible de charger tes procédures.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-4">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  const hasPassword = user.hasPassword;
  const googleLinked = user.linkedProviders.includes('google');

  async function onSubmitProfile(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);

    if (profileName.trim().length === 0) {
      setProfileError('Le nom ne peut pas être vide.');
      return;
    }

    setProfileSubmitting(true);
    try {
      await api('/api/auth/me', {
        method: 'PATCH',
        body: { name: profileName.trim(), phone: profilePhone.trim() },
      });
      toast('Profil mis à jour.', 'success');
      await refresh();
    } catch (err) {
      setProfileError(apiErrorMessage(err, 'Impossible de mettre à jour le profil.'));
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length === 0) {
      setError('Saisis un nouveau mot de passe.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }

    setSubmitting(true);
    try {
      if (hasPassword) {
        await api('/api/auth/change-password', {
          method: 'PUT',
          body: { currentPassword, newPassword },
        });
        toast('Mot de passe mis à jour.', 'success');
      } else {
        await api('/api/auth/set-password', {
          method: 'POST',
          body: { newPassword },
        });
        toast('Mot de passe défini. Tu peux maintenant te connecter par email.', 'success');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          INVALID_CREDENTIALS: 'Mot de passe actuel incorrect.',
          PASSWORD_BANNED: 'Ce mot de passe est trop courant.',
          PASSWORD_TOO_SHORT: err.message || 'Mot de passe trop court.',
          PASSWORD_PWNED: 'Ce mot de passe a fuité — choisis-en un autre.',
          PASSWORD_ALREADY_SET:
            'Un mot de passe est déjà défini. Utilise « changer le mot de passe ».',
          VALIDATION_FAILED: 'Champs invalides.',
        };
        setError(map[err.code] ?? err.message);
      } else {
        setError('Erreur réseau. Réessaie.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function statusLine(proc: MyProcedure): { text: string; complete: boolean } {
    if (proc.tier === 'SIMPLE') {
      return { text: 'Débloqué', complete: false };
    }
    const uploaded = proc.documentsUploaded ?? 0;
    if (proc.checklistTotal > 0 && uploaded === proc.checklistTotal) {
      return { text: 'Dossier complet', complete: true };
    }
    return { text: `${uploaded} / ${proc.checklistTotal} documents déposés`, complete: false };
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl text-ink-900">Paramètres</h1>
        <p className="text-sm text-charcoal-900/60">Connecté en tant que {user.email}</p>
      </header>

      {/* ── Profile section ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.35, ease: DOXI_EASE }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">Mon profil</h2>
          <p className="mt-1 text-sm text-charcoal-900/70">
            Ton nom apparaît sur le CV généré. Le téléphone est optionnel.
          </p>
          <form onSubmit={onSubmitProfile} className="mt-4 flex flex-col gap-4">
            <Input
              label="Nom complet"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Awa Diop"
            />
            <Input
              label="Téléphone"
              type="tel"
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
              placeholder="+221771234567"
              helperText="Format international, ex. +221771234567. Laisse vide pour effacer."
            />
            {profileError && (
              <p role="alert" className="text-sm text-error-600">
                {profileError}
              </p>
            )}
            <div>
              <Button type="submit" loading={profileSubmitting}>
                Enregistrer
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>

      {/* ── Password section ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.35, delay: reduceMotion ? 0 : 0.05, ease: DOXI_EASE }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">
            {hasPassword ? 'Changer le mot de passe' : 'Définir un mot de passe'}
          </h2>
          <p className="mt-1 text-sm text-charcoal-900/70">
            {hasPassword
              ? 'Tu peux modifier ton mot de passe ici. Les autres sessions seront déconnectées.'
              : 'Tu t’es connecté via Google. Définis un mot de passe pour pouvoir aussi te connecter par email.'}
          </p>
          <form onSubmit={onSubmitPassword} className="mt-4 flex flex-col gap-4">
            {hasPassword && (
              <Input
                label="Mot de passe actuel"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
            <Input
              label="Nouveau mot de passe"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Input
              label="Confirmer le nouveau mot de passe"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-error-600">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" loading={submitting}>
                {hasPassword ? 'Changer le mot de passe' : 'Définir le mot de passe'}
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>

      {/* ── Linked providers section ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.35, delay: reduceMotion ? 0 : 0.1, ease: DOXI_EASE }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">Comptes liés</h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-ink-900">Google</span>
              <span className="text-xs text-charcoal-900/60">
                {googleLinked
                  ? 'Tu peux te connecter via Google.'
                  : 'Lie ton compte Google pour te connecter en un clic.'}
              </span>
            </div>
            {googleLinked ? (
              <Badge variant="success">Lié</Badge>
            ) : (
              <a
                href="/api/auth/oauth/google/start?next=/settings"
                className="rounded-xl border border-ink-900/15 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-paper-100"
              >
                Lier Google
              </a>
            )}
          </div>
        </Card>
      </motion.div>

      {/* ── Mes procédures section ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.35, delay: reduceMotion ? 0 : 0.15, ease: DOXI_EASE }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">Mes procédures</h2>

          {proceduresError && <p className="mt-3 text-sm text-error-600">{proceduresError}</p>}

          {procedures === null && !proceduresError && (
            <p className="mt-3 text-sm text-charcoal-900/60">Chargement…</p>
          )}

          {procedures !== null && procedures.length === 0 && (
            <p className="mt-3 text-sm text-charcoal-900/60">
              Tu n'as encore acheté aucune procédure.{' '}
              <Link href="/procedures" className="underline">
                Voir les procédures
              </Link>
            </p>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {procedures?.map((proc) => {
              const status = statusLine(proc);
              return (
                <Link
                  key={proc.slug}
                  href={`/procedures/${proc.slug}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-ink-900/10 p-4 hover:bg-paper-100"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-900">{proc.name}</span>
                      <Badge variant={proc.tier === 'COMPLET' ? 'gold' : 'neutral'}>
                        {proc.tier === 'COMPLET' ? 'Complet' : 'Simple'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-charcoal-900/60">
                      {proc.country}
                      {proc.field ? ` · ${proc.field}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-charcoal-900/75">{status.text}</p>
                  </div>
                  {status.complete && <Stamp size={36} delay={0} />}
                </Link>
              );
            })}
          </div>
        </Card>
      </motion.div>

      <Link href="/procedures" className="text-center text-sm text-charcoal-900/60 underline">
        Retour aux procédures
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
cd frontend
pnpm build
```

Expected: succeeds, `/settings` listed in the route output.

- [ ] **Step 4: Manual smoke check**

```bash
cd frontend
pnpm dev
```

Open `http://localhost:3000/settings` while logged in. Confirm: the page uses Doxi
colors (not gray), the "Mon profil" form saves a name/phone and a page refresh shows the
saved values, the "Mes procédures" section lists any purchased procedures (or the empty
state if none), and a Complet-tier procedure with every document uploaded shows the
`Stamp` next to "Dossier complet". Stop the dev server after checking (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/settings/page.tsx
git commit -m "feat(settings): restyle + profile form + dossier status (Phase 6)"
```
