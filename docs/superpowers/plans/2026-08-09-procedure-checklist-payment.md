# Phase 4 — Procedure Selection + Checklist + Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated student browse a catalog of study-abroad procedures, pay 5 000 FCFA
for one via the existing Bictorys/Order flow (Accompagnement Simple tier), and unlock that
procedure's document checklist once the webhook confirms payment.

**Architecture:** Two new Prisma models (`Procedure`, `ProcedureAccess`). No new payment route —
`POST /api/orders` (unchanged) receives `metadata: {tier: 'SIMPLE', procedureId, procedureSlug}`.
The existing Bictorys webhook's `onPaid` handler creates `ProcedureAccess` inside its existing
Serializable transaction, atomically with the `Order` status flip to `PAID`. Three new GET routes
expose the catalog, gate the checklist behind ownership, and let the payment-return pages read
order status. Four new pages: a catalog grid, a procedure detail/checkout page, and success/failure
landing pages matching the redirect URLs `POST /api/orders` actually uses.

**Tech Stack:** Next.js 16 App Router Route Handlers, Prisma 5 + Neon Postgres, Zod v4, Vitest +
`vitest-mock-extended`, Tailwind v4 with the existing Doxi design tokens, `framer-motion`.

**Spec:** `docs/superpowers/specs/2026-08-09-procedure-checklist-payment-design.md` — read it once
for the full rationale (approved by the founder); this plan does not repeat the "why", only the
"what" and "how".

## Global Constraints

- Every new Route Handler exports `export const runtime = 'nodejs';` (CLAUDE.md invariant — CI
  fails otherwise).
- `frontend/src/lib/server/webhook/handler.ts` is PROTECTED — do not touch it. Only
  `frontend/src/app/api/webhooks/bictorys/route.ts` (the concrete, non-protected wrapper) is
  edited, and only inside the `onPaid` handler.
- `frontend/src/lib/server/outbox/dispatcher.ts` is PROTECTED — this plan reuses the existing
  `notification.payment_received` / `email.payment_confirmation` outbox kinds; no new kind is
  introduced.
- `ProcedureAccess` creation happens **inside** the webhook's existing Serializable transaction
  (`tx.procedureAccess.upsert(...)`), never via the outbox and never as a fire-and-forget closure —
  it must be atomic with the `Order` status write.
- `POST /api/orders` (`frontend/src/app/api/orders/route.ts`) is **not modified** in this plan — it
  already accepts free-form `metadata`. All new routes in this plan are GET-only; none require
  `verifyCsrf`.
- Payment amounts stay integer FCFA (`priceFcfa Int`, no decimals) — `Procedure.priceFcfa` defaults
  to `5000`.
- Non-owned resources return **404**, not 403 (`GET /api/orders/[id]` for another user's order;
  `GET /api/procedures/[slug]` for an unknown slug) — avoids leaking existence, consistent with the
  org-role pattern already in the codebase.
- No admin CRUD for procedures in this phase — the catalog is seeded via
  `frontend/scripts/seed-procedures.ts`, run manually, never from application boot.
- All user-facing copy is real French, tutoiement, no placeholder/lorem text.
- `exactOptionalPropertyTypes: true` is on — never assign `undefined` to a typed optional property;
  use conditional spread (`...(cond ? { key: value } : {})`), the pattern already used throughout
  `frontend/src/app/api/orders/route.ts`.

---

### Task 1: Prisma schema — `Procedure` + `ProcedureAccess` models

**Files:**
- Modify: `frontend/prisma/schema.prisma`

**Interfaces:**
- Produces: `Procedure { id, slug, name, country, field, tagline, checklist: Json, priceFcfa, createdAt }`
  and `ProcedureAccess { id, userId, procedureId, orderId, grantedAt }` with
  `@@unique([userId, procedureId])` (Prisma-generated compound key name `userId_procedureId`,
  consumed by Task 3, 5 and 6) and `orderId @unique`.

- [ ] **Step 1: Add the `User` → `ProcedureAccess` back-relation**

In `frontend/prisma/schema.prisma`, find this block inside `model User`:

```prisma
  adminActions      AdminAction[]
  cvProfile         CvProfile?
```

Replace with:

```prisma
  adminActions      AdminAction[]
  cvProfile         CvProfile?
  procedureAccess   ProcedureAccess[]
```

- [ ] **Step 2: Add the `Order` → `ProcedureAccess` back-relation**

In the same file, find this block inside `model Order`:

```prisma
  provider         String // e.g. "bictorys"
  providerChargeId String? @unique
  paymentUrl       String? // checkout/redirect URL returned by provider
  paymentMethod    String? // WAVE | ORANGE_MONEY | FREE_MONEY (set on PAID by webhook)

  // Optional commission (for marketplace-style apps)
```

Replace with:

```prisma
  provider         String // e.g. "bictorys"
  providerChargeId String? @unique
  paymentUrl       String? // checkout/redirect URL returned by provider
  paymentMethod    String? // WAVE | ORANGE_MONEY | FREE_MONEY (set on PAID by webhook)

  // Doxi Phase 4 — set when this Order paid for Accompagnement Simple
  // access to a Procedure's checklist (Order.metadata.tier === 'SIMPLE').
  procedureAccess ProcedureAccess?

  // Optional commission (for marketplace-style apps)
```

- [ ] **Step 3: Add the two new models**

In the same file, find the end of `model Order` and the start of `model Withdrawal`:

```prisma
  @@index([userId, createdAt])
  @@index([status, expiresAt])
  @@index([provider, providerChargeId])
}

model Withdrawal {
```

Replace with:

```prisma
  @@index([userId, createdAt])
  @@index([status, expiresAt])
  @@index([provider, providerChargeId])
}

// Doxi Phase 4 — Accompagnement Simple: procedure catalog + checklist.
// docs/superpowers/specs/2026-08-09-procedure-checklist-payment-design.md
// Static reference content managed via `pnpm seed:procedures` — no admin
// CRUD surface in this phase.
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

  access ProcedureAccess[]

  @@index([slug])
}

// Grants a user's access to one Procedure's checklist. Created by the
// Bictorys webhook's onPaid handler inside the same Serializable tx as the
// Order status update (see app/api/webhooks/bictorys/route.ts) — never via
// the outbox, so access is atomic with payment confirmation.
//
// userId is non-nullable (unlike Order.userId, which stays nullable for a
// future generic guest-checkout use case) because POST /api/orders already
// requires auth — no guest checkout exists for this flow.
model ProcedureAccess {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  procedureId String
  procedure   Procedure @relation(fields: [procedureId], references: [id], onDelete: Restrict)
  orderId     String    @unique
  order       Order     @relation(fields: [orderId], references: [id], onDelete: Restrict)
  grantedAt   DateTime  @default(now())

  @@unique([userId, procedureId])
  @@index([userId])
}

model Withdrawal {
```

- [ ] **Step 4: Format and generate a migration**

Run, from the repo root:

```bash
pnpm --filter frontend exec prisma format
pnpm --filter frontend exec prisma migrate dev --name doxi_procedures
```

Expected: a new folder under `frontend/prisma/migrations/` (timestamp-prefixed,
`_doxi_procedures` suffix) containing the generated SQL, and the migration applies cleanly against
your local Neon `DATABASE_URL`. `prisma generate` runs automatically as part of `migrate dev` and
regenerates `@prisma/client` types (`PrismaClient.procedure`, `PrismaClient.procedureAccess`
become available).

- [ ] **Step 5: Verify**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no new type errors (confirms the generated Prisma client picked up the new models).

- [ ] **Step 6: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(db): add Procedure + ProcedureAccess models (Phase 4)"
```

---

### Task 2: Seed script for the procedure catalog

**Files:**
- Create: `frontend/scripts/seed-procedures.ts`
- Test: `frontend/scripts/seed-procedures.test.ts`
- Modify: `frontend/package.json` (add `seed:procedures` script)
- Modify: `package.json` (add thin-wrapper `seed:procedures` script)

**Interfaces:**
- Consumes: `Procedure` model from Task 1 (`prisma.procedure.upsert`).
- Produces: `main(args?: string[], deps?: { prisma?: PrismaClient }): Promise<void>` — same shape as
  `frontend/scripts/seed-dev.ts`'s `main`, importable by its own test without a real DB connection.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/seed-procedures.test.ts`:

```typescript
// Companion unit test for scripts/seed-procedures.ts — mirrors
// scripts/seed-dev.test.ts's mocked-PrismaClient pattern (no real DB
// connection, no subprocess spawn).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { main } from './seed-procedures';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe('scripts/seed-procedures', () => {
  it('upserts every procedure in the catalog, keyed by slug', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    expect(prismaMock.procedure.upsert).toHaveBeenCalledTimes(5);
    const firstCall = prismaMock.procedure.upsert.mock.calls[0]?.[0];
    expect(firstCall?.where).toEqual({ slug: 'campus-france' });
  });

  it('stores a non-empty checklist array for every procedure', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    for (const call of prismaMock.procedure.upsert.mock.calls) {
      const createData = call[0]?.create as { checklist: unknown[] };
      expect(Array.isArray(createData.checklist)).toBe(true);
      expect(createData.checklist.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — running twice performs the same 5 upserts both times', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });
    await main([], { prisma: prismaMock });

    expect(prismaMock.procedure.upsert).toHaveBeenCalledTimes(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend exec vitest run scripts/seed-procedures.test.ts`
Expected: FAIL with "Cannot find module './seed-procedures'"

- [ ] **Step 3: Write the seed script**

Create `frontend/scripts/seed-procedures.ts`:

```typescript
// Doxi Phase 4 — seed script for the procedure catalog (Accompagnement
// Simple tier). Static reference content, not admin-managed in this phase.
// docs/superpowers/specs/2026-08-09-procedure-checklist-payment-design.md
//
// Usage: pnpm seed:procedures
//
// Idempotent — upsert keyed on `slug`, safe to re-run (e.g. after editing a
// checklist below) without duplicating rows. Mirrors scripts/seed-dev.ts's
// main(args, deps) shape so tests can inject a mocked PrismaClient.

import { pathToFileURL } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';

interface ChecklistItem {
  title: string;
  description?: string;
}

interface ProcedureSeed {
  slug: string;
  name: string;
  country: string;
  field?: string;
  tagline: string;
  priceFcfa: number;
  checklist: ChecklistItem[];
}

const PROCEDURES: ProcedureSeed[] = [
  {
    slug: 'campus-france',
    name: 'Campus France',
    country: 'France',
    tagline: 'La procédure obligatoire pour candidater aux universités françaises.',
    priceFcfa: 5000,
    checklist: [
      {
        title: 'Passeport en cours de validité',
        description: 'Valide au moins 6 mois après la date de départ prévue.',
      },
      {
        title: 'Relevés de notes des 2 ou 3 dernières années',
        description: 'Traduits en français si l’original est dans une autre langue.',
      },
      { title: 'Diplômes obtenus (ou attestation de scolarité en cours)' },
      { title: 'Lettre de motivation', description: 'Adaptée à chaque formation demandée.' },
      { title: 'CV à jour' },
      {
        title: 'Justificatif de ressources financières',
        description: 'Preuve de capacité à financer au moins la première année.',
      },
      { title: 'Certificat de français (TCF/TEF) si la formation l’exige' },
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
      { title: 'Passeport en cours de validité' },
      {
        title: '3 lettres de recommandation',
        description:
          'D’employeurs ou d’enseignants, soumises directement en ligne par les référents.',
      },
      {
        title: 'Essais de candidature Chevening',
        description:
          '4 essais courts sur le leadership, le réseau, les études et les objectifs de carrière.',
      },
      { title: 'CV à jour' },
      { title: 'Diplômes et relevés de notes' },
      { title: 'Preuve de 2 ans d’expérience professionnelle minimum' },
      {
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
      { title: 'Passeport en cours de validité' },
      { title: 'Lettre d’admission ou de pré-admission d’un établissement canadien reconnu' },
      {
        title: 'Relevés de notes officiels',
        description: 'Traduits en français ou en anglais.',
      },
      { title: 'Lettre de motivation' },
      { title: '2 à 3 lettres de recommandation académiques' },
      {
        title: 'Preuve de compétence linguistique (IELTS/TEF)',
        description: 'Selon la langue d’enseignement du programme visé.',
      },
      {
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
      { title: 'Passeport en cours de validité' },
      { title: 'Copie légalisée du baccalauréat ou du dernier diplôme obtenu' },
      { title: 'Relevés de notes légalisés des 2 dernières années' },
      { title: 'Certificat médical d’aptitude', description: 'Délivré par un médecin agréé.' },
      { title: 'Extrait d’acte de naissance' },
      { title: 'Photos d’identité récentes' },
      {
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
      { title: 'Passeport en cours de validité' },
      {
        title: 'Diplôme le plus récent et relevés de notes',
        description: 'Traduits et si besoin apostillés.',
      },
      { title: 'Lettre de motivation' },
      {
        title: 'Lettres de recommandation',
        description: 'Nombre variable selon le niveau d’études visé.',
      },
      { title: 'Certificat médical attestant l’absence de maladie contagieuse' },
      { title: 'Photos d’identité récentes' },
      { title: 'Candidature en ligne complétée sur le portail Türkiye Scholarships' },
    ],
  },
];

interface SeedDeps {
  // Injectable for tests — defaults to a freshly-instantiated PrismaClient
  // when called as a CLI.
  prisma?: PrismaClient;
}

export async function main(_args: string[] = [], deps: SeedDeps = {}): Promise<void> {
  const prisma = deps.prisma ?? new PrismaClient();
  try {
    for (const proc of PROCEDURES) {
      const { slug, field, checklist, ...rest } = proc;
      const data = {
        ...rest,
        field: field ?? null,
        checklist: checklist as unknown as Prisma.InputJsonValue,
      };
      const row = await prisma.procedure.upsert({
        where: { slug },
        update: data,
        create: { slug, ...data },
        select: { slug: true, name: true },
      });
      console.log(`✓ ${row.slug} — ${row.name}`);
    }
  } finally {
    // Only disconnect the real client; tests pass their own mock and close
    // it themselves.
    if (!deps.prisma) {
      await prisma.$disconnect();
    }
  }
}

// CLI entrypoint guard — only run when invoked as a script, not when
// imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend exec vitest run scripts/seed-procedures.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the `seed:procedures` scripts**

In `frontend/package.json`, find:

```json
    "seed:dev": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/seed-dev.ts",
```

Add immediately after it:

```json
    "seed:procedures": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/seed-procedures.ts",
```

In the root `package.json`, find:

```json
    "seed:dev": "pnpm --filter frontend run seed:dev",
```

Add immediately after it:

```json
    "seed:procedures": "pnpm --filter frontend run seed:procedures",
```

- [ ] **Step 6: Run the full test suite to confirm nothing else broke**

Run: `pnpm --filter frontend exec vitest run`
Expected: all tests pass (existing count + 3 new)

- [ ] **Step 7: Commit**

```bash
git add frontend/scripts/seed-procedures.ts frontend/scripts/seed-procedures.test.ts frontend/package.json package.json
git commit -m "feat(seed): add procedure catalog seed script (Phase 4)"
```

---

### Task 3: Webhook `onPaid` — grant `ProcedureAccess` on payment confirmation

**Files:**
- Modify: `frontend/src/app/api/webhooks/bictorys/route.ts`
- Modify: `frontend/src/app/api/webhooks/bictorys/route.test.ts`

**Interfaces:**
- Consumes: `Procedure`/`ProcedureAccess` from Task 1; `tx.procedureAccess.upsert` inside the
  `PrismaTransactionClient` the protected `webhook/handler.ts` factory already passes to `onPaid`.
- Produces: nothing new consumed by later tasks — this task closes the write side. Task 5/6 read
  what this task writes.

- [ ] **Step 1: Add the failing test cases**

In `frontend/src/app/api/webhooks/bictorys/route.test.ts`, find the mock declarations near the top:

```typescript
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const outboxCreate = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: { findUnique, create, update },
    order: { findFirst: orderFindFirst, update: orderUpdate },
    outboxEvent: { create: outboxCreate },
  }),
);
```

Replace with:

```typescript
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const outboxCreate = vi.fn();
const procedureAccessUpsert = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: { findUnique, create, update },
    order: { findFirst: orderFindFirst, update: orderUpdate },
    outboxEvent: { create: outboxCreate },
    procedureAccess: { upsert: procedureAccessUpsert },
  }),
);
```

Find the `beforeEach` block:

```typescript
beforeEach(() => {
  vi.stubEnv('BICTORYS_API_URL', 'https://api.bictorys.test');
  vi.stubEnv('BICTORYS_API_KEY', 'test-api-key');
  vi.stubEnv('BICTORYS_WEBHOOK_SECRET', 'test-webhook-secret');
  vi.stubEnv('BICTORYS_WEBHOOK_REPLAY_WINDOW_MS', '60000');
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  orderFindFirst.mockReset();
  orderUpdate.mockReset();
  outboxCreate.mockReset();
});
```

Replace with:

```typescript
beforeEach(() => {
  vi.stubEnv('BICTORYS_API_URL', 'https://api.bictorys.test');
  vi.stubEnv('BICTORYS_API_KEY', 'test-api-key');
  vi.stubEnv('BICTORYS_WEBHOOK_SECRET', 'test-webhook-secret');
  vi.stubEnv('BICTORYS_WEBHOOK_REPLAY_WINDOW_MS', '60000');
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  orderFindFirst.mockReset();
  orderUpdate.mockReset();
  outboxCreate.mockReset();
  procedureAccessUpsert.mockReset();
});
```

Add these two tests at the end of the `describe('POST /api/webhooks/bictorys', ...)` block, just
before its closing `});`:

```typescript
  it('onPaid creates ProcedureAccess for a SIMPLE-tier order with procedureId (Phase 4)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o1',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    procedureAccessUpsert.mockResolvedValue({ id: 'pa1' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o1' },
      update: {},
    });
  });

  it('onPaid does not create ProcedureAccess when metadata has no tier/procedureId (Phase 4)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o2',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: null,
    });
    outboxCreate.mockResolvedValue({ id: 'ob2' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts`
Expected: the 2 new tests FAIL (`procedureAccessUpsert` never called — `onPaid` doesn't create it yet)

- [ ] **Step 3: Extend `onPaid`**

In `frontend/src/app/api/webhooks/bictorys/route.ts`, add the import and schema near the top. Find:

```typescript
import 'server-only';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import { bictorysWebhookProvider } from '@/lib/server/webhook/bictorys';
import { enqueueOutbox } from '@/lib/server/outbox';
import { prisma } from '@/lib/server/prisma';
```

Replace with:

```typescript
import 'server-only';
import { z } from 'zod';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import { bictorysWebhookProvider } from '@/lib/server/webhook/bictorys';
import { enqueueOutbox } from '@/lib/server/outbox';
import { prisma } from '@/lib/server/prisma';

// Doxi Phase 4 — recognized shape of Order.metadata for an Accompagnement
// Simple purchase. Both fields optional: most Orders (e.g. future tiers,
// other products) won't carry them, and that's the expected default case.
const OrderMetadata = z.object({
  tier: z.string().optional(),
  procedureId: z.string().optional(),
});
```

Then, inside `onPaid`, find:

```typescript
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        ...(paymentMethod !== null ? { paymentMethod } : {}),
      },
    });

    // Outbox emits stay inside the factory's Serializable tx so the rows
```

Replace with:

```typescript
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        ...(paymentMethod !== null ? { paymentMethod } : {}),
      },
    });

    // Doxi Phase 4 — grant checklist access for the Accompagnement Simple
    // tier. Runs inside the same Serializable tx as the status update above
    // so access is atomic with payment confirmation — never an outbox side
    // effect. @@unique([userId, procedureId]) makes this upsert idempotent
    // across webhook replays.
    if (order.userId) {
      const meta = OrderMetadata.safeParse(order.metadata);
      if (meta.success && meta.data.tier === 'SIMPLE' && meta.data.procedureId) {
        await tx.procedureAccess.upsert({
          where: {
            userId_procedureId: {
              userId: order.userId,
              procedureId: meta.data.procedureId,
            },
          },
          create: {
            userId: order.userId,
            procedureId: meta.data.procedureId,
            orderId: order.id,
          },
          update: {},
        });
      }
    }

    // Outbox emits stay inside the factory's Serializable tx so the rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors (`tx.procedureAccess` resolves against the `PrismaTransactionClient` type
because the protected `webhook/handler.ts` derives it via `Omit<PrismaClient, ...>`, which now
includes the Task-1 model automatically).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/webhooks/bictorys/route.ts frontend/src/app/api/webhooks/bictorys/route.test.ts
git commit -m "feat(webhook): grant ProcedureAccess on Accompagnement Simple payment (Phase 4)"
```

---

### Task 4: `GET /api/procedures` — public catalog list

**Files:**
- Create: `frontend/src/app/api/procedures/route.ts`
- Test: `frontend/src/app/api/procedures/route.test.ts`

**Interfaces:**
- Consumes: `Procedure` model from Task 1.
- Produces: `GET /api/procedures` → `200 { id, slug, name, country, field, tagline, priceFcfa }[]`
  (no `checklist` field — this response is publicly reachable without auth). Consumed by Task 7's
  `/procedures` page.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/procedures/route.test.ts`:

```typescript
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/procedures', { method: 'GET' });
}

describe('GET /api/procedures', () => {
  it('returns the procedure list without leaking checklist content', async () => {
    prismaMock.procedure.findMany.mockResolvedValue([
      {
        id: 'proc_1',
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tagline: 'Candidature aux universités françaises.',
        priceFcfa: 5000,
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
        select: expect.not.objectContaining({ checklist: true }),
      }),
    );
  });

  it('returns an empty array when no procedures exist', async () => {
    prismaMock.procedure.findMany.mockResolvedValue([]);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/app/api/procedures/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

Create `frontend/src/app/api/procedures/route.ts`:

```typescript
// Doxi Phase 4 — GET /api/procedures. Public catalog list, no auth
// required. Never selects `checklist` — that's the content being sold,
// gated behind ProcedureAccess in GET /api/procedures/[slug] (Task 5).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PROCEDURE_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  priceFcfa: true,
} satisfies Prisma.ProcedureSelect;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const procedures = await prisma.procedure.findMany({
      select: PROCEDURE_LIST_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(procedures, {
      status: 200,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend exec vitest run src/app/api/procedures/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Confirm the runtime-enforcement tripwire is satisfied**

Run: `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts`
Expected: PASS (the new route exports `runtime = 'nodejs'`)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/procedures/route.ts frontend/src/app/api/procedures/route.test.ts
git commit -m "feat(api): add GET /api/procedures catalog list (Phase 4)"
```

---

### Task 5: `GET /api/procedures/[slug]` — detail, checklist gated by access

**Files:**
- Create: `frontend/src/app/api/procedures/[slug]/route.ts`
- Test: `frontend/src/app/api/procedures/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `Procedure`/`ProcedureAccess` from Task 1; `optionalAuth` from
  `@/lib/server/middleware` (signature: `optionalAuth(authHeader?: string | null): Promise<{user: {sub: string; email: string}} | null>`).
- Produces: `GET /api/procedures/:slug` → `200 { id, slug, name, country, field, tagline, priceFcfa, hasAccess: boolean, checklist?: Json }`
  (`checklist` present only when `hasAccess === true`) or `404 { error: 'PROCEDURE_NOT_FOUND' }`.
  Consumed by Task 8's `/procedures/[slug]` page.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/procedures/[slug]/route.test.ts`:

```typescript
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  optionalAuth: vi.fn(),
}));

import { optionalAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockOptionalAuth = vi.mocked(optionalAuth);

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/procedures/campus-france', { method: 'GET' });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const PROCEDURE_ROW = {
  id: 'proc_1',
  slug: 'campus-france',
  name: 'Campus France',
  country: 'France',
  field: null,
  tagline: 'Candidature aux universités françaises.',
  priceFcfa: 5000,
  checklist: [{ title: 'Passeport en cours de validité' }],
};

describe('GET /api/procedures/[slug]', () => {
  beforeEach(() => {
    mockOptionalAuth.mockResolvedValue(null);
  });

  it('returns 404 for an unknown slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctxFor('unknown'));
    expect(res.status).toBe(404);
  });

  it('omits checklist and returns hasAccess:false for an anonymous caller', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasAccess).toBe(false);
    expect(body).not.toHaveProperty('checklist');
  });

  it('omits checklist and returns hasAccess:false for an authenticated caller without access', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.hasAccess).toBe(false);
    expect(body).not.toHaveProperty('checklist');
  });

  it('includes checklist and hasAccess:true when the caller holds ProcedureAccess', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ id: 'pa1' } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.hasAccess).toBe(true);
    expect(body.checklist).toEqual([{ title: 'Passeport en cours de validité' }]);
    expect(prismaMock.procedureAccess.findUnique).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'user-1', procedureId: 'proc_1' } },
      select: { id: true },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend exec vitest run "src/app/api/procedures/[slug]/route.test.ts"`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

Create `frontend/src/app/api/procedures/[slug]/route.ts`:

```typescript
// Doxi Phase 4 — GET /api/procedures/[slug]. optionalAuth so both guests
// and authenticated callers can view a procedure's name/tagline/price;
// `checklist` (the content being sold) is only included when the caller
// holds a ProcedureAccess row for it.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { optionalAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PROCEDURE_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  priceFcfa: true,
  checklist: true,
} satisfies Prisma.ProcedureSelect;

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
    let hasAccess = false;
    if (auth) {
      const access = await prisma.procedureAccess.findUnique({
        where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
        select: { id: true },
      });
      hasAccess = access !== null;
    }

    const { checklist, ...publicFields } = procedure;
    return NextResponse.json(
      {
        ...publicFields,
        hasAccess,
        ...(hasAccess ? { checklist } : {}),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend exec vitest run "src/app/api/procedures/[slug]/route.test.ts"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/procedures/[slug]/route.ts" "frontend/src/app/api/procedures/[slug]/route.test.ts"
git commit -m "feat(api): add GET /api/procedures/[slug] with access-gated checklist (Phase 4)"
```

---

### Task 6: `GET /api/orders/[id]` — owner-only order status lookup

**Files:**
- Create: `frontend/src/app/api/orders/[id]/route.ts`
- Test: `frontend/src/app/api/orders/[id]/route.test.ts`

**Interfaces:**
- Consumes: `requireAuth` from `@/lib/server/middleware` (signature:
  `requireAuth(authHeader?: string | null): Promise<{user: {sub: string; email: string}} | NextResponse>`);
  existing `Order` model (unmodified).
- Produces: `GET /api/orders/:id` → `200 { status, amount, currency, metadata }` for the order's
  owner, or `404 { error: 'ORDER_NOT_FOUND' }` for a missing/foreign order. Generic to the `Order`
  flow (not procedure-specific) — consumed by Task 9's success/failed pages to read
  `metadata.procedureSlug`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/orders/[id]/route.test.ts`:

```typescript
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/orders/order_1', { method: 'GET' });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/orders/[id]', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when the order belongs to a different user', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'someone-else',
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: null,
    } as never);
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(404);
  });

  it('returns status/amount/currency/metadata for the owner', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user-1',
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1', procedureSlug: 'campus-france' },
    } as never);
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1', procedureSlug: 'campus-france' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend exec vitest run "src/app/api/orders/[id]/route.test.ts"`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

Create `frontend/src/app/api/orders/[id]/route.ts`:

```typescript
// Doxi Phase 4 — GET /api/orders/[id]. Owner-only lookup, generic to the
// Order flow (not procedure-specific) — the extension point for any future
// payment-return page, not just Phase 4's. 404 (not 403) for a foreign
// order to avoid revealing that an order id exists.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const order = await prisma.order.findUnique({
      where: { id },
      select: { userId: true, status: true, amount: true, currency: true, metadata: true },
    });
    if (!order || order.userId !== auth.user.sub) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return NextResponse.json(
      {
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        metadata: order.metadata,
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend exec vitest run "src/app/api/orders/[id]/route.test.ts"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/api/orders/[id]/route.ts" "frontend/src/app/api/orders/[id]/route.test.ts"
git commit -m "feat(api): add GET /api/orders/[id] owner-only lookup (Phase 4)"
```

---

### Task 7: `/procedures` page — catalog grid

**Files:**
- Create: `frontend/src/app/procedures/page.tsx`

**Interfaces:**
- Consumes: `GET /api/procedures` from Task 4; `Card`, `Badge` from `@/components/ui`; `formatPrice`
  from `@/lib/utils`; `api`, `ApiError` from `@/lib/api`.

This page has no server logic to unit-test (client-side data fetching only, matching the existing
`frontend/src/app/cv/page.tsx` pattern) — verified manually in Task 11.

- [ ] **Step 1: Create the page**

Create `frontend/src/app/procedures/page.tsx`:

```tsx
// /procedures — catalogue public des procédures (Accompagnement Simple).
// Consultable sans compte ; l'achat (voir /procedures/[slug]) redirige vers
// /login si nécessaire.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { Card, Badge } from '@/components/ui';
import { formatPrice } from '@/lib/utils';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

interface ProcedureListItem {
  id: string;
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  priceFcfa: number;
}

// `api.ts` (PROTECTED) sets `ApiError.message` from the response body's
// `error` field — the stable code, not the user-facing copy. Every route
// in this plan also returns a French `message` field, reachable via
// `err.body.message`. Prefer that; fall back if it's absent/malformed.
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function ProceduresPage() {
  const [procedures, setProcedures] = useState<ProcedureListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    api<ProcedureListItem[]>('/api/procedures')
      .then((data) => {
        if (!cancelled) setProcedures(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Impossible de charger les procédures.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        Accompagnement Simple
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Choisis ta procédure</h1>
      <p className="mt-2 max-w-xl text-sm text-charcoal-900/70">
        Débloque la checklist des documents requis pour une procédure, pour{' '}
        {formatPrice(5000)} FCFA.
      </p>

      {error && <p className="mt-8 text-sm text-error-600">{error}</p>}

      {procedures === null && !error && (
        <p className="mt-8 text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {procedures !== null && procedures.length === 0 && (
        <p className="mt-8 text-sm text-charcoal-900/60">
          Aucune procédure disponible pour le moment.
        </p>
      )}

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {procedures?.map((proc, i) => (
          <motion.div
            key={proc.id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, delay: i * 0.05, ease: DOXI_EASE }}
          >
            <Link href={`/procedures/${proc.slug}`}>
              <Card bordered className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium text-ink-900">{proc.name}</h2>
                    <p className="mt-1 text-sm text-charcoal-900/60">
                      {proc.country}
                      {proc.field ? ` · ${proc.field}` : ''}
                    </p>
                  </div>
                  <Badge variant="gold">{formatPrice(proc.priceFcfa)} FCFA</Badge>
                </div>
                <p className="mt-4 text-sm text-charcoal-900/75">{proc.tagline}</p>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual visual check**

Run `pnpm dev`, sign in as any seeded user (`pnpm seed:dev` if you haven't already), visit
`http://localhost:3000/procedures`. Expected: either a loading state then an empty-state message
(if Task 2's seed hasn't run yet) or a grid of procedure cards once `pnpm seed:procedures` has run.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/procedures/page.tsx
git commit -m "feat(ui): add /procedures catalog page (Phase 4)"
```

---

### Task 8: `/procedures/[slug]` page — detail, checkout, checklist

**Files:**
- Create: `frontend/src/app/procedures/[slug]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/procedures/[slug]` from Task 5; `POST /api/orders` (existing, unmodified) with
  body `{amount, currency: 'XOF', metadata: {tier: 'SIMPLE', procedureId, procedureSlug}}` and header
  `Idempotency-Key`; `Card`, `Badge`, `Button`, `Accordion`, `AccordionItemData` from
  `@/components/ui`; `formatPrice`, `isInAppBrowser` from `@/lib/utils`; `useAuth` from
  `@/contexts/AuthContext`; `useToast` from `@/contexts/ToastContext`.

- [ ] **Step 1: Create the page**

Create `frontend/src/app/procedures/[slug]/page.tsx`:

```tsx
// /procedures/[slug] — détail d'une procédure : checklist si déjà achetée,
// sinon bouton d'achat (Accompagnement Simple, 5 000 FCFA) via le flux
// Bictorys existant (POST /api/orders, inchangé — voir CLAUDE.md).
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Badge, Button, Accordion, type AccordionItemData } from '@/components/ui';
import { formatPrice, isInAppBrowser } from '@/lib/utils';

interface ChecklistItem {
  title: string;
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
  hasAccess: boolean;
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
  const [buying, setBuying] = useState(false);
  const [inAppWarning, setInAppWarning] = useState(false);

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

  async function handleBuy() {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!procedure) return;

    setBuying(true);
    try {
      const res = await api<{ id: string; paymentUrl: string; status: string }>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          amount: procedure.priceFcfa,
          currency: 'XOF',
          metadata: {
            tier: 'SIMPLE',
            procedureId: procedure.id,
            procedureSlug: procedure.slug,
          },
        },
      });
      window.location.href = res.paymentUrl;
    } catch (err) {
      toast(apiErrorMessage(err, 'Le paiement n’a pas pu être initié.'), 'error');
      setBuying(false);
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

  const checklistItems: AccordionItemData[] = (procedure.checklist ?? []).map((item, i) => ({
    id: `item-${i}`,
    title: item.title,
    content: item.description ?? '',
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
        <Card bordered className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-ink-900">Checklist des documents</h2>
            <Badge variant="success">Débloquée</Badge>
          </div>
          <div className="mt-4">
            {checklistItems.length > 0 ? (
              <Accordion items={checklistItems} type="multiple" />
            ) : (
              <p className="text-sm text-charcoal-900/60">Aucun document listé.</p>
            )}
          </div>
        </Card>
      ) : (
        <Card bordered className="mt-8">
          <p className="text-sm text-charcoal-900/75">
            Débloque la checklist complète des documents requis pour cette procédure, avec la
            marche à suivre détaillée.
          </p>
          {inAppWarning && (
            <p className="mt-4 rounded-lg bg-seal-gold/10 px-3 py-2 text-xs text-ink-900">
              Pour un paiement mobile money sans problème, ouvre ce lien dans Chrome ou Safari
              plutôt que dans cette application.
            </p>
          )}
          <Button variant="primary" className="mt-5 w-full" loading={buying} onClick={handleBuy}>
            Débloquer pour {formatPrice(procedure.priceFcfa)} FCFA
          </Button>
        </Card>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual click-through**

With `pnpm dev` running and `pnpm seed:procedures` applied: visit `/procedures/campus-france` while
logged out → confirm the checklist is hidden and the buy button reads "Débloquer pour 5 000 FCFA".
Click it → confirm redirect to `/login` (no crash). Log in, return to the same page, click buy again
→ if `BICTORYS_*` env vars aren't configured locally, confirm a toast shows
"Le paiement n'a pas pu être initié." rather than a silent failure or crash (503
`PAYMENT_PROVIDER_UNCONFIGURED` is expected in a dev environment without real Bictorys credentials —
this is the correct, already-tested behavior of the unmodified `/api/orders` route).

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/procedures/[slug]/page.tsx"
git commit -m "feat(ui): add /procedures/[slug] detail + checkout page (Phase 4)"
```

---

### Task 9: `/orders/[id]/success` and `/orders/[id]/failed` pages

**Files:**
- Create: `frontend/src/app/orders/[id]/success/page.tsx`
- Create: `frontend/src/app/orders/[id]/failed/page.tsx`

**Interfaces:**
- Consumes: `GET /api/orders/[id]` from Task 6. These are the pages `POST /api/orders`'s
  `successUrl`/`failureUrl` (`${publicUrl}/orders/${order.id}/success` /
  `${publicUrl}/orders/${order.id}/failed`, see `frontend/src/app/api/orders/route.ts`) actually
  redirect to — not the stale `/payment/success?o=` convention documented (incorrectly) in
  `examples/frontend-pages/payment-success.tsx`'s header comment. Do not copy that example file.

- [ ] **Step 1: Create the success page**

Create `frontend/src/app/orders/[id]/success/page.tsx`:

```tsx
// /orders/[id]/success — landing after a Bictorys checkout redirect for a
// successful charge. The webhook may not have processed the payment yet by
// the time the browser lands here, so this page polls GET /api/orders/[id]
// briefly until status leaves PENDING.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, Button } from '@/components/ui';

interface OrderStatus {
  status: string;
  amount: number;
  currency: string;
  metadata: { procedureSlug?: string } | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 10;

export default function OrderSuccessPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api<OrderStatus>(`/api/orders/${orderId}`)
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        if (data.status === 'PENDING' && pollCount < MAX_POLLS) {
          setTimeout(() => {
            if (!cancelled) setPollCount((c) => c + 1);
          }, POLL_INTERVAL_MS);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Impossible de vérifier ce paiement.'));
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, pollCount]);

  const procedureSlug = order?.metadata?.procedureSlug;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <Card bordered className="w-full">
        {error && <p className="text-sm text-error-600">{error}</p>}

        {!error && !order && (
          <p className="text-sm text-charcoal-900/60">Vérification du paiement…</p>
        )}

        {!error && order?.status === 'PENDING' && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Confirmation en cours</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">
              Ton paiement est en cours de traitement. Cette page se mettra à jour
              automatiquement.
            </p>
          </>
        )}

        {!error && order?.status === 'PAID' && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Paiement confirmé</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">Merci — ta checklist est prête.</p>
            {procedureSlug && (
              <Link href={`/procedures/${procedureSlug}`} className="mt-6 block">
                <Button variant="primary" className="w-full">
                  Voir la checklist
                </Button>
              </Link>
            )}
          </>
        )}

        {!error && order && order.status !== 'PENDING' && order.status !== 'PAID' && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Paiement non confirmé</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">
              Ce paiement n’a pas abouti. Réessaie depuis la page de la procédure.
            </p>
            {procedureSlug && (
              <Link href={`/procedures/${procedureSlug}`} className="mt-6 block">
                <Button variant="secondary" className="w-full">
                  Retour à la procédure
                </Button>
              </Link>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Create the failed page**

Create `frontend/src/app/orders/[id]/failed/page.tsx`:

```tsx
// /orders/[id]/failed — landing after a Bictorys checkout redirect for a
// failed or cancelled charge.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, Button } from '@/components/ui';

interface OrderStatus {
  metadata: { procedureSlug?: string } | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function OrderFailedPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [procedureSlug, setProcedureSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<OrderStatus>(`/api/orders/${orderId}`)
      .then((data) => {
        if (!cancelled) setProcedureSlug(data.metadata?.procedureSlug ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, ''));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <Card bordered className="w-full">
        <h1 className="font-serif text-2xl text-ink-900">Paiement échoué</h1>
        <p className="mt-2 text-sm text-charcoal-900/70">
          Le paiement n’a pas pu être finalisé. Aucune somme n’a été débitée si tu as annulé avant
          la fin.
        </p>
        {error && <p className="mt-2 text-xs text-error-600">{error}</p>}
        <Link
          href={procedureSlug ? `/procedures/${procedureSlug}` : '/procedures'}
          className="mt-6 block"
        >
          <Button variant="secondary" className="w-full">
            Réessayer
          </Button>
        </Link>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual visual check**

With `pnpm dev` running, visit `http://localhost:3000/orders/does-not-exist/success` and
`/orders/does-not-exist/failed` while logged in. Expected: both show a graceful "Impossible de
vérifier ce paiement." / not-found style message (via the 404 from Task 6's route) rather than a
crash.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/orders/[id]/success/page.tsx" "frontend/src/app/orders/[id]/failed/page.tsx"
git commit -m "feat(ui): add /orders/[id]/success and /failed payment-return pages (Phase 4)"
```

---

### Task 10: Fix Pricing.tsx copy — Simple tier no longer promises document generation

**Files:**
- Modify: `frontend/src/components/landing/Pricing.tsx`

**Interfaces:** none (copy-only change).

The landing page's existing Pricing section (built in an earlier phase) lists "1 document généré au
choix" as a feature of the "Accompagnement Simple" tier. Per this phase's approved spec, Simple only
unlocks a checklist — no AI document generation (that's reserved for the Complet tier, Phase 5+).
Left uncorrected, the landing page would promise a capability this phase doesn't build.

- [ ] **Step 1: Fix the feature list**

In `frontend/src/components/landing/Pricing.tsx`, find:

```tsx
    features: [
      'Checklist des documents requis',
      'Marche à suivre détaillée',
      '1 document généré au choix',
    ],
    cta: 'Choisir l’offre Simple',
```

Replace with:

```tsx
    features: [
      'Checklist des documents requis',
      'Marche à suivre détaillée',
      'Accès immédiat après paiement',
    ],
    cta: 'Choisir l’offre Simple',
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual visual check**

Run `pnpm dev`, visit `/` (or wherever `<Pricing />` is mounted), confirm the "Accompagnement
Simple" card's third bullet now reads "Accès immédiat après paiement".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/landing/Pricing.tsx
git commit -m "fix(landing): Simple tier no longer promises AI document generation (Phase 4)"
```

---

### Task 11: Full verification pass

**Files:** none — verification only.

- [ ] **Step 1: Full quality gate**

Run, from the repo root:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all green. `pnpm test` should show the existing suite count plus the new tests added in
Tasks 2, 3, 4, 5, 6 (3 + 2 + 2 + 4 + 4 = 15 new tests).

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: succeeds; the route listing includes `/api/procedures`, `/api/procedures/[slug]`,
`/api/orders/[id]` (all `ƒ` dynamic) and `/procedures`, `/procedures/[slug]`,
`/orders/[id]/success`, `/orders/[id]/failed` (pages).

- [ ] **Step 3: Apply the migration and seed a local dev database**

If not already applied from Task 1:

```bash
pnpm db:migrate:status
pnpm seed:procedures
```

Expected: `db:migrate:status` shows the Phase 4 migration applied; `seed:procedures` prints 5 lines
(`✓ campus-france — Campus France`, etc.) and is safe to re-run.

- [ ] **Step 4: End-to-end manual smoke test**

With `pnpm dev` running against a database that has run both `pnpm seed:dev` and
`pnpm seed:procedures`:

1. Log in as `user@example.com` / `UserPassword123!` (from `seed-dev.ts`).
2. Visit `/procedures` — confirm 5 cards render with real names/countries/prices.
3. Click into `/procedures/campus-france` — confirm the checklist is hidden, "Débloquer pour
   5 000 FCFA" button is visible.
4. Click the buy button — confirm either a redirect to a Bictorys checkout URL (if `BICTORYS_*` env
   vars are configured) or a toast error (if not) — never a crash or blank page.
5. If `BICTORYS_*` is configured and you can complete a real (or sandbox) charge: confirm landing on
   `/orders/<id>/success`, the page resolving from "Confirmation en cours" to "Paiement confirmé"
   within a few seconds, and `/procedures/campus-france` now showing the unlocked checklist.
6. Visit `/orders/some-fake-id/failed` directly — confirm it renders the failure card with a
   "Réessayer" link to `/procedures` (no slug known, so the generic catalog link), not a crash.

- [ ] **Step 5: Report**

No commit for this task (verification only). If every check in Steps 1-4 passes, Phase 4 is
functionally complete and ready for the final whole-branch review.
