# Doxi Phase 3 — CV Wizard + AI Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 2 `/cv` intro screen with a real 5-step CV questionnaire, and add
Claude-powered CV generation with a printable preview.

**Architecture:** Extend the existing `CvProfile` model (no new table) with `generatedCv`/
`generatedAt`. Add a small `AiProvider` abstraction (mirrors `PaymentProvider`) wrapping the
Anthropic SDK, wired through a factory that returns `null` when unconfigured. The wizard is a
client-side multi-step form that auto-saves each step via the existing `PATCH /api/cv`
(extended to merge a JSON `answers` blob per step key). A new `POST /api/cv/generate` route
validates completeness, rate-limits, calls the AI provider, and persists the result. The
preview is a view-swap inside `/cv` (no new route) with `window.print()` PDF export.

**Tech Stack:** Next.js 16 App Router route handlers, Prisma 5, Zod v4, React Hook Form +
`@hookform/resolvers/zod`, `@anthropic-ai/sdk` (new dependency), Vitest + `vitest-mock-extended`.

## Global Constraints

- Every route handler must `export const runtime = 'nodejs'`.
- Mutating routes call `verifyCsrf(req)` then `requireAuth()`, bailing on `instanceof NextResponse`.
- `exactOptionalPropertyTypes: true` — build optional Prisma input fields via conditional
  assignment (`if (x !== undefined) obj.x = x`), never by spreading a `T | undefined` value or
  passing `undefined` explicitly into a prop/field typed without `| undefined`.
- No new server-side PDF dependency — PDF export is `window.print()` + `@media print` CSS.
- AI generation is capped at 5 requests / 24h per user (server-enforced).
- The AI system prompt must forbid inventing facts not present in the student's answers.
- French tutoiement copy throughout; no placeholder/lorem text.
- `pnpm format && pnpm lint && pnpm typecheck && pnpm test` must stay green after every task.
- Prisma CLI reads `frontend/.env` (not `.env.local`) — already contains `DATABASE_URL`/`DIRECT_URL`.

---

### Task 1: Prisma schema — `generatedCv`/`generatedAt` on `CvProfile`

**Files:**
- Modify: `frontend/prisma/schema.prisma` (the `CvProfile` model, currently lines 190-201)
- Migration: `frontend/prisma/migrations/<timestamp>_doxi_cv_generation/` (generated)

**Interfaces:**
- Produces: `CvProfile.generatedCv: Json | null`, `CvProfile.generatedAt: DateTime | null` — consumed by Task 3 (route) and Task 6 (generate route).

- [ ] **Step 1: Edit the `CvProfile` model**

In `frontend/prisma/schema.prisma`, replace the existing model:

```prisma
model CvProfile {
  id            String    @id @default(cuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  targetCountry String?
  targetField   String?
  // Freeform structured answers from the multi-step wizard — shape owned by
  // frontend/src/lib/validation/cv-wizard.ts, not enforced at the DB layer.
  answers       Json      @default("{}")
  // Last AI-generated CV (GeneratedCv shape from cv-wizard.ts). Regenerating
  // overwrites this — history isn't kept in Phase 3.
  generatedCv   Json?
  generatedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm --filter frontend exec prisma migrate dev --name doxi_cv_generation`

Expected: a new folder under `frontend/prisma/migrations/` containing `migration.sql` with
`ALTER TABLE "CvProfile" ADD COLUMN "generatedCv" JSONB, ADD COLUMN "generatedAt" TIMESTAMP(3);`
(exact column type may read `JSONB`/`TIMESTAMP(3)` per Prisma's Postgres mapping), and the
Prisma Client is regenerated (`prisma generate` runs automatically as part of `migrate dev`).

If the dev server is running in the background, stop it first — a live server holds a lock on
`query_engine-windows.dll.node` on Windows and `prisma generate` will fail with `EPERM`.

- [ ] **Step 3: Verify the client picked up the new fields**

Run: `pnpm --filter frontend exec tsc --noEmit`

Expected: no errors. (This alone won't reference the new fields yet — it just confirms the
Prisma Client regenerated cleanly.)

- [ ] **Step 4: Commit**

```bash
git add frontend/prisma/schema.prisma frontend/prisma/migrations
git commit -m "feat(cv): add generatedCv/generatedAt to CvProfile"
```

---

### Task 2: Zod validation module — `cv-wizard.ts`

**Files:**
- Create: `frontend/src/lib/validation/cv-wizard.ts`
- Test: `frontend/src/lib/validation/cv-wizard.test.ts`

**Interfaces:**
- Consumes: nothing (pure Zod, no server imports — safe for both client wizard forms and server routes).
- Produces (consumed by Tasks 3, 4, 6, 7, 8, 9):
  - `WIZARD_STEPS: readonly ['identity', 'education', 'experience', 'skills', 'objective']`
  - `type WizardStepKey = (typeof WIZARD_STEPS)[number]`
  - `identityStepSchema`, `type IdentityStep`
  - `educationEntrySchema`, `type EducationEntry`; `educationStepSchema`, `type EducationStep`
  - `experienceEntrySchema`, `type ExperienceEntry`; `experienceStepSchema`, `type ExperienceStep`
  - `languageEntrySchema`, `type LanguageEntry`; `skillsStepSchema`, `type SkillsStep`
  - `objectiveStepSchema`, `type ObjectiveStep`
  - `cvAnswersSchema`, `type CvAnswers` (all 5 step keys optional)
  - `generatedCvSectionSchema`, `type GeneratedCvSection`; `generatedCvSchema`, `type GeneratedCv`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/validation/cv-wizard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  WIZARD_STEPS,
  identityStepSchema,
  educationStepSchema,
  experienceStepSchema,
  skillsStepSchema,
  objectiveStepSchema,
  cvAnswersSchema,
  generatedCvSchema,
} from './cv-wizard';

describe('WIZARD_STEPS', () => {
  it('lists the 5 steps in order', () => {
    expect(WIZARD_STEPS).toEqual(['identity', 'education', 'experience', 'skills', 'objective']);
  });
});

describe('identityStepSchema', () => {
  it('accepts a valid identity', () => {
    const result = identityStepSchema.safeParse({
      fullName: 'Awa Ndiaye',
      email: 'awa@example.com',
      phone: '+221771234567',
      city: 'Dakar',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing fullName', () => {
    const result = identityStepSchema.safeParse({
      fullName: '',
      email: 'awa@example.com',
      phone: '+221771234567',
      city: 'Dakar',
    });
    expect(result.success).toBe(false);
  });
});

describe('educationStepSchema', () => {
  it('accepts at least one entry', () => {
    const result = educationStepSchema.safeParse({
      entries: [{ institution: 'UCAD', degree: 'Licence Informatique', startYear: 2021, endYear: 2024 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects zero entries', () => {
    const result = educationStepSchema.safeParse({ entries: [] });
    expect(result.success).toBe(false);
  });

  it('accepts a null endYear for ongoing studies', () => {
    const result = educationStepSchema.safeParse({
      entries: [{ institution: 'UCAD', degree: 'Master', startYear: 2024, endYear: null }],
    });
    expect(result.success).toBe(true);
  });
});

describe('experienceStepSchema', () => {
  it('defaults to an empty entries array', () => {
    const result = experienceStepSchema.parse({});
    expect(result.entries).toEqual([]);
  });

  it('accepts a filled entry', () => {
    const result = experienceStepSchema.safeParse({
      entries: [{ title: 'Stagiaire vente', organization: 'Auchan Dakar', description: 'Conseil client, gestion caisse.' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('skillsStepSchema', () => {
  it('requires at least one skill', () => {
    const result = skillsStepSchema.safeParse({ skills: [], languages: [] });
    expect(result.success).toBe(false);
  });

  it('accepts skills and languages', () => {
    const result = skillsStepSchema.safeParse({
      skills: ['Excel', 'Prise de parole'],
      languages: [{ name: 'Français', level: 'NATIF' }, { name: 'Anglais', level: 'COURANT' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid language level', () => {
    const result = skillsStepSchema.safeParse({
      skills: ['Excel'],
      languages: [{ name: 'Anglais', level: 'PARFAIT' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('objectiveStepSchema', () => {
  it('requires targetCountry and targetField', () => {
    const result = objectiveStepSchema.safeParse({ targetCountry: '', targetField: 'Informatique' });
    expect(result.success).toBe(false);
  });

  it('accepts an optional targetProgram', () => {
    const result = objectiveStepSchema.safeParse({
      targetCountry: 'France',
      targetField: 'Informatique',
      targetProgram: 'Master 2 Data Science',
    });
    expect(result.success).toBe(true);
  });
});

describe('cvAnswersSchema', () => {
  it('accepts a partial answers object with only one step', () => {
    const result = cvAnswersSchema.safeParse({
      identity: { fullName: 'Awa Ndiaye', email: 'awa@example.com', phone: '+221771234567', city: 'Dakar' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty object', () => {
    const result = cvAnswersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects a step present but malformed', () => {
    const result = cvAnswersSchema.safeParse({ identity: { fullName: '' } });
    expect(result.success).toBe(false);
  });
});

describe('generatedCvSchema', () => {
  it('accepts a summary + sections shape', () => {
    const result = generatedCvSchema.safeParse({
      summary: 'Étudiante motivée en informatique.',
      sections: [{ title: 'Formation', bullets: ['Licence Informatique — UCAD (2021-2024)'] }],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/lib/validation/cv-wizard.test.ts`
Expected: FAIL — `Cannot find module './cv-wizard'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/validation/cv-wizard.ts`:

```ts
import { z } from 'zod';

// Client + server shared schemas for the CV Builder wizard. Client forms use
// these as RHF resolvers; server routes use them to validate the `answers`
// JSON blob on CvProfile and the AI-generated CV shape. No `server-only`
// import here — this module must be importable from client components.

export const WIZARD_STEPS = ['identity', 'education', 'experience', 'skills', 'objective'] as const;
export type WizardStepKey = (typeof WIZARD_STEPS)[number];

export const identityStepSchema = z.object({
  fullName: z.string().min(1, 'Ton nom est requis.').max(100),
  email: z.string().email('Adresse e-mail invalide.'),
  phone: z.string().min(6, 'Numéro de téléphone invalide.').max(20),
  city: z.string().min(1, 'Ta ville est requise.').max(100),
});
export type IdentityStep = z.infer<typeof identityStepSchema>;

export const educationEntrySchema = z.object({
  institution: z.string().min(1, "Le nom de l'établissement est requis.").max(150),
  degree: z.string().min(1, 'Le diplôme/la filière est requis.').max(150),
  startYear: z.number().int().min(1980).max(2100),
  endYear: z.number().int().min(1980).max(2100).nullable(),
});
export type EducationEntry = z.infer<typeof educationEntrySchema>;

export const educationStepSchema = z.object({
  entries: z.array(educationEntrySchema).min(1, 'Ajoute au moins une formation.').max(10),
});
export type EducationStep = z.infer<typeof educationStepSchema>;

export const experienceEntrySchema = z.object({
  title: z.string().min(1, 'Le titre est requis.').max(150),
  organization: z.string().min(1, "Le nom de l'organisation est requis.").max(150),
  description: z.string().min(1, 'Décris brièvement ce que tu as fait.').max(1000),
});
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;

export const experienceStepSchema = z.object({
  entries: z.array(experienceEntrySchema).max(10).default([]),
});
export type ExperienceStep = z.infer<typeof experienceStepSchema>;

export const languageEntrySchema = z.object({
  name: z.string().min(1, 'Le nom de la langue est requis.').max(60),
  level: z.enum(['DEBUTANT', 'INTERMEDIAIRE', 'COURANT', 'BILINGUE', 'NATIF']),
});
export type LanguageEntry = z.infer<typeof languageEntrySchema>;

export const skillsStepSchema = z.object({
  skills: z.array(z.string().min(1).max(60)).min(1, 'Ajoute au moins une compétence.').max(20),
  languages: z.array(languageEntrySchema).max(10).default([]),
});
export type SkillsStep = z.infer<typeof skillsStepSchema>;

export const objectiveStepSchema = z.object({
  targetCountry: z.string().min(1, 'Le pays cible est requis.').max(100),
  targetField: z.string().min(1, 'Le domaine est requis.').max(100),
  targetProgram: z.string().max(150).optional(),
});
export type ObjectiveStep = z.infer<typeof objectiveStepSchema>;

export const cvAnswersSchema = z.object({
  identity: identityStepSchema.optional(),
  education: educationStepSchema.optional(),
  experience: experienceStepSchema.optional(),
  skills: skillsStepSchema.optional(),
  objective: objectiveStepSchema.optional(),
});
export type CvAnswers = z.infer<typeof cvAnswersSchema>;

export const generatedCvSectionSchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()),
});
export type GeneratedCvSection = z.infer<typeof generatedCvSectionSchema>;

export const generatedCvSchema = z.object({
  summary: z.string(),
  sections: z.array(generatedCvSectionSchema),
});
export type GeneratedCv = z.infer<typeof generatedCvSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend exec vitest run src/lib/validation/cv-wizard.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/validation/cv-wizard.ts frontend/src/lib/validation/cv-wizard.test.ts
git commit -m "feat(cv): add cv-wizard Zod schemas for the 5-step questionnaire"
```

---

### Task 3: Extend `/api/cv` — merge `answers`, return full draft shape

**Files:**
- Modify: `frontend/src/app/api/cv/route.ts` (existing GET/PATCH, currently 90 lines)
- Test: Create `frontend/src/app/api/cv/route.test.ts`

**Interfaces:**
- Consumes: `cvAnswersSchema`, `type CvAnswers`, `generatedCvSchema`, `type GeneratedCv` from `@/lib/validation/cv-wizard` (Task 2).
- Produces: GET/PATCH both return
  `{ targetCountry: string | null; targetField: string | null; answers: CvAnswers; generatedCv: GeneratedCv | null; generatedAt: string | null; updatedAt: string | null }` — consumed by Task 8 (wizard) and Task 9 (preview).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/cv/route.test.ts`:

```ts
// Mock strategy mirrors src/app/api/upload/route.test.ts — requireAuth/verifyCsrf
// stubbed happy by default, prisma.cvProfile mocked so no real DB is hit.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

const cvProfileFindUnique = vi.fn();
const cvProfileUpsert = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: {
    cvProfile: {
      findUnique: (...args: unknown[]) => cvProfileFindUnique(...args),
      upsert: (...args: unknown[]) => cvProfileUpsert(...args),
    },
  },
}));

function makeReq(method: string, body?: unknown) {
  return new Request(new URL('http://localhost/api/cv'), {
    method,
    headers: { 'x-csrf-token': 'test-csrf', 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/cv', () => {
  it('returns nulls/empty answers when no draft exists', async () => {
    cvProfileFindUnique.mockResolvedValueOnce(null);
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      targetCountry: null,
      targetField: null,
      answers: {},
      generatedCv: null,
      generatedAt: null,
      updatedAt: null,
    });
  });

  it('returns the stored draft', async () => {
    const updatedAt = new Date('2026-08-09T12:00:00.000Z');
    cvProfileFindUnique.mockResolvedValueOnce({
      targetCountry: 'France',
      targetField: 'Informatique',
      answers: { identity: { fullName: 'Awa' } },
      generatedCv: null,
      generatedAt: null,
      updatedAt,
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET') as never);
    const body = await res.json();
    expect(body.targetCountry).toBe('France');
    expect(body.answers).toEqual({ identity: { fullName: 'Awa' } });
    expect(body.updatedAt).toBe(updatedAt.toISOString());
  });
});

describe('PATCH /api/cv', () => {
  it('merges a new step into existing answers without clobbering others', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({
      answers: { identity: { fullName: 'Awa', email: 'awa@example.com', phone: '+221771234567', city: 'Dakar' } },
    });
    cvProfileUpsert.mockImplementationOnce(async (args: unknown) => ({
      targetCountry: null,
      targetField: null,
      answers: (args as { update: { answers: unknown } }).update.answers,
      generatedCv: null,
      generatedAt: null,
      updatedAt: new Date('2026-08-09T12:05:00.000Z'),
    }));

    const { PATCH } = await import('./route');
    const res = await PATCH(
      makeReq('PATCH', {
        answers: {
          education: { entries: [{ institution: 'UCAD', degree: 'Licence', startYear: 2021, endYear: 2024 }] },
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answers.identity.fullName).toBe('Awa');
    expect(body.answers.education.entries).toHaveLength(1);
  });

  it('rejects a malformed step', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: {} });
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { answers: { identity: { fullName: '' } } }) as never);
    expect(res.status).toBe(400);
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { targetCountry: 'France' }) as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { targetCountry: 'France' }) as never);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/app/api/cv/route.test.ts`
Expected: FAIL — current route doesn't return `answers`/`generatedCv`/`generatedAt`, and PATCH doesn't accept `answers`.

- [ ] **Step 3: Rewrite the route**

Replace the full contents of `frontend/src/app/api/cv/route.ts`:

```ts
// Doxi — GET + PATCH /api/cv
//
// One in-progress CV draft per user (`CvProfile`, unique on userId). GET
// returns the current draft (or nulls/empty answers if none started yet).
// PATCH upserts targetCountry/targetField and/or merges a partial `answers`
// blob — one wizard step at a time, keyed by step name (identity/education/
// experience/skills/objective). Merge is shallow at the step-key level: a
// step submitted in this request replaces that step's prior value wholesale,
// but every other step's data is untouched. Same last-write-wins semantic as
// notifications/prefs — not worth a Serializable transaction for a
// single-user draft.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { cvAnswersSchema, generatedCvSchema, type CvAnswers, type GeneratedCv } from '@/lib/validation/cv-wizard';

const PatchBody = z.object({
  targetCountry: z.string().min(1).max(100).optional(),
  targetField: z.string().min(1).max(100).optional(),
  answers: cvAnswersSchema.optional(),
});

const CV_SELECT = {
  targetCountry: true,
  targetField: true,
  answers: true,
  generatedCv: true,
  generatedAt: true,
  updatedAt: true,
} satisfies Prisma.CvProfileSelect;

type CvProfileRow = {
  targetCountry: string | null;
  targetField: string | null;
  answers: Prisma.JsonValue;
  generatedCv: Prisma.JsonValue | null;
  generatedAt: Date | null;
  updatedAt: Date;
} | null;

function parseAnswers(raw: Prisma.JsonValue | undefined): CvAnswers {
  const parsed = cvAnswersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

function parseGeneratedCv(raw: Prisma.JsonValue | null | undefined): GeneratedCv | null {
  if (raw === null || raw === undefined) return null;
  const parsed = generatedCvSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function serialize(row: CvProfileRow) {
  return {
    targetCountry: row?.targetCountry ?? null,
    targetField: row?.targetField ?? null,
    answers: parseAnswers(row?.answers),
    generatedCv: parseGeneratedCv(row?.generatedCv),
    generatedAt: row?.generatedAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const draft = await prisma.cvProfile.findUnique({
      where: { userId: auth.user.sub },
      select: CV_SELECT,
    });

    return NextResponse.json(serialize(draft), {
      status: 200,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => null);
    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const { targetCountry, targetField, answers } = parsed.data;

    // Built with narrowed conditional assignment rather than spreading
    // `parsed.data` directly — exactOptionalPropertyTypes rejects an
    // explicit `string | undefined` flowing into Prisma's `string | null`
    // input types, even though the key would be omitted at runtime either way.
    const createData: Prisma.CvProfileUncheckedCreateInput = { userId: auth.user.sub };
    if (targetCountry !== undefined) createData.targetCountry = targetCountry;
    if (targetField !== undefined) createData.targetField = targetField;
    if (answers !== undefined) createData.answers = answers as unknown as Prisma.InputJsonValue;

    const updateData: Prisma.CvProfileUncheckedUpdateInput = {};
    if (targetCountry !== undefined) updateData.targetCountry = targetCountry;
    if (targetField !== undefined) updateData.targetField = targetField;
    if (answers !== undefined) {
      const existing = await prisma.cvProfile.findUnique({
        where: { userId: auth.user.sub },
        select: { answers: true },
      });
      const mergedAnswers: CvAnswers = { ...parseAnswers(existing?.answers), ...answers };
      updateData.answers = mergedAnswers as unknown as Prisma.InputJsonValue;
    }

    const draft = await prisma.cvProfile.upsert({
      where: { userId: auth.user.sub },
      create: createData,
      update: updateData,
      select: CV_SELECT,
    });

    return NextResponse.json(serialize(draft), {
      status: 200,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend exec vitest run src/app/api/cv/route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/cv/route.ts frontend/src/app/api/cv/route.test.ts
git commit -m "feat(cv): merge per-step answers in PATCH /api/cv, return full draft shape"
```

---

### Task 4: AI module — `AiProvider` abstraction + Claude implementation

**Files:**
- Create: `frontend/src/lib/server/ai/provider.ts`
- Create: `frontend/src/lib/server/ai/claude.ts`
- Create: `frontend/src/lib/server/ai/index.ts`
- Test: Create `frontend/src/lib/server/ai/index.test.ts`
- Modify: `frontend/package.json` (add `@anthropic-ai/sdk`)
- Modify: `.env.example`, `frontend/.env.local` (add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`)

**Interfaces:**
- Consumes: `type CvAnswers`, `generatedCvSchema`, `type GeneratedCv` from `@/lib/validation/cv-wizard` (Task 2).
- Produces (consumed by Task 6): `getAiProvider(): AiProvider | null`, `interface AiProvider { name: string; generateCv(input: { answers: CvAnswers }): Promise<GeneratedCv> }`.

- [ ] **Step 1: Add the Anthropic SDK dependency**

Run: `pnpm --filter frontend add @anthropic-ai/sdk`

Expected: `frontend/package.json` gains `"@anthropic-ai/sdk": "^<version>"` under `dependencies`,
lockfile updates.

- [ ] **Step 2: Add the env vars**

In `.env.example`, after the "6. OPTIONAL — Cloudinary" block (around line 139) and before the
"7. OPTIONAL — Google OAuth" block, insert:

```
# =============================================================================
# 6b. OPTIONAL — AI (Claude / Anthropic)
# =============================================================================
# Required for POST /api/cv/generate — without this the route returns
# 503 AI_NOT_CONFIGURED. Get a key at https://console.anthropic.com.

ANTHROPIC_API_KEY=""

# Optional override — defaults to the current Claude Sonnet model in code
# (see frontend/src/lib/server/ai/index.ts) if left empty.
ANTHROPIC_MODEL=""
```

Mirror the same two empty keys into `frontend/.env.local` in the same relative position
(after the `CLOUDINARY_UPLOAD_PRESET=""` line).

- [ ] **Step 3: Write the provider interface**

Create `frontend/src/lib/server/ai/provider.ts`:

```ts
/**
 * Provider-agnostic AI interface. Mirrors payments/provider.ts's shape:
 * routes consume `AiProvider`, never the concrete Claude adapter, so
 * swapping/adding providers is one wiring change in `index.ts`.
 */
import type { CvAnswers, GeneratedCv } from '@/lib/validation/cv-wizard';

export interface CvGenerationInput {
  answers: CvAnswers;
}

export interface AiProvider {
  /** Short identifier (used for logging). */
  name: string;

  generateCv(input: CvGenerationInput): Promise<GeneratedCv>;
}
```

- [ ] **Step 4: Write the Claude implementation**

Create `frontend/src/lib/server/ai/claude.ts`:

```ts
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { generatedCvSchema, type CvAnswers, type GeneratedCv } from '@/lib/validation/cv-wizard';
import type { AiProvider, CvGenerationInput } from './provider';

export interface CreateClaudeProviderOptions {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'emit_cv';

const CV_TOOL = {
  name: TOOL_NAME,
  description: 'Emit the finished CV content as structured JSON.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string' as const,
        description: 'A 2-3 sentence professional summary in French.',
      },
      sections: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            title: { type: 'string' as const },
            bullets: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['title', 'bullets'],
        },
      },
    },
    required: ['summary', 'sections'],
  },
};

function buildSystemPrompt(): string {
  return [
    "Tu es un assistant qui aide des étudiants ouest-africains à rédiger un CV professionnel " +
      "pour une candidature à l'étranger (bourses, admissions, visas études).",
    'Réécris les informations fournies par l’étudiant en un CV clair et professionnel : ' +
      'reformule en une accroche courte et des puces concises, adapte le ton et le vocabulaire ' +
      'au pays et au domaine visés. Écris en français, tutoiement interdit ici (le CV s’adresse ' +
      'à un recruteur/jury, pas à l’étudiant).',
    'RÈGLE ABSOLUE : n’invente aucun fait, date, employeur, diplôme, compétence ou résultat qui ' +
      'n’est pas explicitement fourni par l’étudiant. Si une information manque, ne comble pas le ' +
      'vide — reste sobre et fidèle aux données reçues.',
    'Réponds uniquement en appelant l’outil emit_cv avec le CV complet.',
  ].join('\n');
}

function buildUserPrompt(answers: CvAnswers): string {
  return JSON.stringify(answers, null, 2);
}

export function createClaudeProvider(options: CreateClaudeProviderOptions): AiProvider {
  const client = new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: 'claude',
    async generateCv({ answers }: CvGenerationInput): Promise<GeneratedCv> {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPrompt(answers) }],
        tools: [CV_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error('Claude response did not include the expected tool_use block');
      }

      return generatedCvSchema.parse(toolUse.input);
    },
  };
}
```

- [ ] **Step 5: Write the factory (with a test first)**

Create `frontend/src/lib/server/ai/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./claude', () => ({
  createClaudeProvider: vi.fn((options: { apiKey: string; model?: string }) => ({
    name: 'claude',
    apiKey: options.apiKey,
    model: options.model,
    generateCv: vi.fn(),
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getAiProvider', () => {
  it('returns null when ANTHROPIC_API_KEY is absent', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { getAiProvider } = await import('./index');
    expect(getAiProvider()).toBeNull();
  });

  it('returns a provider when ANTHROPIC_API_KEY is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { getAiProvider } = await import('./index');
    const provider = getAiProvider();
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe('claude');
  });

  it('caches the provider across calls', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { getAiProvider } = await import('./index');
    expect(getAiProvider()).toBe(getAiProvider());
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/lib/server/ai/index.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 7: Write the factory implementation**

Create `frontend/src/lib/server/ai/index.ts`:

```ts
import 'server-only';
import { createClaudeProvider } from './claude';
import type { AiProvider } from './provider';

// Lazy singleton — mirrors redis.ts's `Redis | null` pattern. Env is read
// inside the function (not at module top) so vi.stubEnv works in tests and
// the app never crashes at import time when the key is absent.
let _provider: AiProvider | null | undefined;

export function getAiProvider(): AiProvider | null {
  if (_provider !== undefined) return _provider;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    _provider = null;
    return null;
  }

  const model = process.env.ANTHROPIC_MODEL;
  _provider = createClaudeProvider(model ? { apiKey, model } : { apiKey });
  return _provider;
}

/**
 * Test-only escape hatch — clears the cached provider so a test can mutate
 * `process.env.ANTHROPIC_*` and re-trigger lazy init. Never call from
 * application code.
 * @internal
 */
export function __resetAiProviderSingleton(): void {
  _provider = undefined;
}

export type { AiProvider, CvGenerationInput } from './provider';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter frontend exec vitest run src/lib/server/ai/index.test.ts`
Expected: PASS (3 tests).

Note: the singleton caches across the whole test file (module-level `_provider`), so the
"returns null" test must run before "returns a provider" — Vitest runs `it` blocks in
declared order within a `describe`, so this holds as written. If tests are reordered later,
call `__resetAiProviderSingleton()` in a `beforeEach` importing it dynamically the same way.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml .env.example frontend/.env.local \
  frontend/src/lib/server/ai/
git commit -m "feat(ai): add AiProvider abstraction + Claude implementation"
```

---

### Task 5: Per-user generation rate limiter

**Files:**
- Create: `frontend/src/lib/server/cv/generation-limiter.ts`
- Test: Create `frontend/src/lib/server/cv/generation-limiter.test.ts`

**Interfaces:**
- Consumes: `RateLimitStore`, `MemoryRateLimitStore`, `RedisRateLimitStore` from
  `../rate-limit-store` (existing, protected — read-only use).
- Produces (consumed by Task 6): `createGenerationLimiter(deps: { redis?: Redis }): { check(userId: string): Promise<NextResponse | null> }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/server/cv/generation-limiter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createGenerationLimiter } from './generation-limiter';

describe('createGenerationLimiter (in-memory, redis absent)', () => {
  let limiter: ReturnType<typeof createGenerationLimiter>;

  beforeEach(() => {
    limiter = createGenerationLimiter({});
  });

  it('allows the first 5 requests for a user', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await limiter.check('user-1');
      expect(res).toBeNull();
    }
  });

  it('rejects the 6th request with 429', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    const body = await res?.json();
    expect(body.error).toBe('CV_GENERATION_RATE_LIMITED');
  });

  it('tracks separate buckets per user', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-2');
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/lib/server/cv/generation-limiter.test.ts`
Expected: FAIL — `Cannot find module './generation-limiter'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/server/cv/generation-limiter.ts`:

```ts
/**
 * Per-user rate limit for POST /api/cv/generate — 5 generations/regenerations
 * per user per 24h. Same store primitives as rate-limit-by-email.ts, keyed by
 * userId instead of email (generation always happens post-auth, so there's
 * always a userId — no IP fallback needed).
 *
 * Backed by Upstash Redis when available, in-memory otherwise. The
 * dependency-injected `redis` (rather than importing the singleton directly)
 * mirrors rate-limit-by-email.ts's `CreateEmailLimiterDeps` so tests can
 * exercise both branches without touching real env/network.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { Redis } from '@upstash/redis';
import { MemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore } from '../rate-limit-store';
import { log } from '../observability/log';

export interface CreateGenerationLimiterDeps {
  redis?: Redis;
}

export interface GenerationLimiter {
  check(userId: string): Promise<NextResponse | null>;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_GENERATIONS = 5;

export function createGenerationLimiter(deps: CreateGenerationLimiterDeps): GenerationLimiter {
  if (!deps.redis) {
    log.warn('cv-generate rate limiter using in-memory fallback (Redis absent)');
  }

  const store: RateLimitStore = deps.redis
    ? new RedisRateLimitStore({ redis: deps.redis, prefix: 'rl:cv-generate:', windowMs: WINDOW_MS })
    : new MemoryRateLimitStore({ windowMs: WINDOW_MS });

  return {
    async check(userId: string) {
      const { totalHits, resetTime } = await store.increment(`user:${userId}`);
      if (totalHits > MAX_GENERATIONS) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: 'CV_GENERATION_RATE_LIMITED',
            message: 'Tu as atteint la limite de 5 générations aujourd’hui, réessaie demain.',
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(MAX_GENERATIONS),
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

Run: `pnpm --filter frontend exec vitest run src/lib/server/cv/generation-limiter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/server/cv/
git commit -m "feat(cv): add per-user generation rate limiter"
```

---

### Task 6: `POST /api/cv/generate` route

**Files:**
- Create: `frontend/src/app/api/cv/generate/route.ts`
- Test: Create `frontend/src/app/api/cv/generate/route.test.ts`

**Interfaces:**
- Consumes: `WIZARD_STEPS`, `cvAnswersSchema`, `type CvAnswers` (Task 2); `getAiProvider` (Task 4);
  `createGenerationLimiter` (Task 5); `redis` from `@/lib/server/redis`.
- Produces: `{ generatedCv: GeneratedCv; generatedAt: string }` on 200 — consumed by Task 9 (preview).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/api/cv/generate/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

vi.mock('@/lib/server/redis', () => ({ redis: null }));

const generateCv = vi.fn(async () => ({
  summary: 'Étudiante motivée.',
  sections: [{ title: 'Formation', bullets: ['Licence Informatique — UCAD'] }],
}));
vi.mock('@/lib/server/ai', () => ({
  getAiProvider: vi.fn(() => ({ name: 'claude', generateCv })),
}));

// The limiter is instantiated once at module scope in the route (same
// convention as login/route.ts's module-level `limiter`), so its internal
// MemoryRateLimitStore would otherwise accumulate hits *across* unrelated
// `it()` blocks in this file (dynamic `import('./route')` reuses the same
// module instance unless `vi.resetModules()` runs). Mock it here — the
// limiter's own accumulation behavior is covered in isolation by
// generation-limiter.test.ts (Task 5); this file only needs to assert the
// route reacts correctly to an allow/deny decision.
const limiterCheck = vi.fn(async () => null);
vi.mock('@/lib/server/cv/generation-limiter', () => ({
  createGenerationLimiter: vi.fn(() => ({ check: (...args: unknown[]) => limiterCheck(...args) })),
}));

const cvProfileFindUnique = vi.fn();
const cvProfileUpdate = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: {
    cvProfile: {
      findUnique: (...args: unknown[]) => cvProfileFindUnique(...args),
      update: (...args: unknown[]) => cvProfileUpdate(...args),
    },
  },
}));

const COMPLETE_ANSWERS = {
  identity: { fullName: 'Awa', email: 'awa@example.com', phone: '+221771234567', city: 'Dakar' },
  education: { entries: [{ institution: 'UCAD', degree: 'Licence', startYear: 2021, endYear: 2024 }] },
  experience: { entries: [] },
  skills: { skills: ['Excel'], languages: [] },
  objective: { targetCountry: 'France', targetField: 'Informatique' },
};

function makeReq() {
  return new Request(new URL('http://localhost/api/cv/generate'), {
    method: 'POST',
    headers: { 'x-csrf-token': 'test-csrf' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cvProfileUpdate.mockImplementation(async (args: unknown) => ({
    generatedCv: (args as { data: { generatedCv: unknown } }).data.generatedCv,
    generatedAt: new Date('2026-08-09T13:00:00.000Z'),
  }));
});

describe('POST /api/cv/generate', () => {
  it('generates and persists a CV when the profile is complete', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedCv.summary).toBe('Étudiante motivée.');
    expect(generateCv).toHaveBeenCalledWith({ answers: COMPLETE_ANSWERS });
    expect(cvProfileUpdate).toHaveBeenCalled();
  });

  it('returns 400 INCOMPLETE_PROFILE when a step is missing', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({
      answers: { ...COMPLETE_ANSWERS, skills: undefined },
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INCOMPLETE_PROFILE');
  });

  it('returns 503 AI_NOT_CONFIGURED when no provider is available', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    const { getAiProvider } = await import('@/lib/server/ai');
    (getAiProvider as unknown as Mock).mockReturnValueOnce(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('returns 502 AI_GENERATION_FAILED when the provider throws', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    generateCv.mockImplementationOnce(async () => {
      throw new Error('Claude timeout');
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AI_GENERATION_FAILED');
  });

  it('returns the limiter response verbatim when the rate limit is exceeded', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    limiterCheck.mockResolvedValueOnce(
      NextResponse.json({ error: 'CV_GENERATION_RATE_LIMITED' }, { status: 429 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('CV_GENERATION_RATE_LIMITED');
    expect(generateCv).not.toHaveBeenCalled();
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend exec vitest run src/app/api/cv/generate/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/app/api/cv/generate/route.ts`:

```ts
// Doxi — POST /api/cv/generate
//
// Pipeline: CSRF → auth → load+validate answers (all 5 steps required) →
// per-user rate limit (5/24h) → AI provider (503 if unconfigured, 502 if it
// throws) → persist generatedCv/generatedAt → return.
//
// Wizard answers are never touched by this route — a failed generation
// (rate limit, AI down) leaves the student's filled-in steps exactly as
// they were.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { WIZARD_STEPS, cvAnswersSchema, type CvAnswers } from '@/lib/validation/cv-wizard';
import { getAiProvider } from '@/lib/server/ai';
import { createGenerationLimiter } from '@/lib/server/cv/generation-limiter';

function parseAnswers(raw: Prisma.JsonValue | undefined): CvAnswers {
  const parsed = cvAnswersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

// Module-level limiter — same convention as auth/login/route.ts's module-level
// `limiter`. Must NOT be constructed inside POST(): a fresh limiter per
// request means a fresh in-memory store per request, so hits would never
// accumulate and the 5/24h cap would never trigger when Redis is absent.
const limiter = createGenerationLimiter({ redis: redis ?? undefined });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const profile = await prisma.cvProfile.findUnique({
      where: { userId: auth.user.sub },
      select: { answers: true },
    });
    const answers = parseAnswers(profile?.answers);

    const missingStep = WIZARD_STEPS.find((step) => !answers[step]);
    if (missingStep) {
      return NextResponse.json(
        {
          error: 'INCOMPLETE_PROFILE',
          message: `L'étape "${missingStep}" n'est pas encore remplie.`,
          missingStep,
        },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const limited = await limiter.check(auth.user.sub);
    if (limited) return limited;

    const ai = getAiProvider();
    if (!ai) {
      return NextResponse.json(
        { error: 'AI_NOT_CONFIGURED', message: "La génération IA n'est pas encore disponible." },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    let generatedCv;
    try {
      generatedCv = await ai.generateCv({ answers });
    } catch {
      return NextResponse.json(
        { error: 'AI_GENERATION_FAILED', message: 'La génération a échoué, réessaie dans un instant.' },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const updated = await prisma.cvProfile.update({
      where: { userId: auth.user.sub },
      data: {
        generatedCv: generatedCv as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
      select: { generatedCv: true, generatedAt: true },
    });

    return NextResponse.json(
      { generatedCv: updated.generatedCv, generatedAt: updated.generatedAt?.toISOString() ?? null },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend exec vitest run src/app/api/cv/generate/route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Confirm the runtime-enforcement tripwire is satisfied**

Run: `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts`
Expected: PASS — the new route declares `export const runtime = 'nodejs'`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/api/cv/generate/
git commit -m "feat(cv): add POST /api/cv/generate route"
```

---

### Task 7: Wizard step form components

**Files:**
- Create: `frontend/src/components/cv/IdentityStepForm.tsx`
- Create: `frontend/src/components/cv/EducationStepForm.tsx`
- Create: `frontend/src/components/cv/ExperienceStepForm.tsx`
- Create: `frontend/src/components/cv/SkillsStepForm.tsx`
- Create: `frontend/src/components/cv/ObjectiveStepForm.tsx`
- Create: `frontend/src/components/cv/index.ts` (barrel export)

**Interfaces:**
- Consumes: `identityStepSchema`/`IdentityStep`, `educationStepSchema`/`EducationStep`,
  `experienceStepSchema`/`ExperienceStep`, `skillsStepSchema`/`SkillsStep`,
  `objectiveStepSchema`/`ObjectiveStep` (Task 2); `Button`, `Input`, `Card` from `@/components/ui`.
- Produces (consumed by Task 8): each component has the signature
  `function XStepForm({ defaultValues, onSubmit, submitLabel }: { defaultValues: Partial<X>; onSubmit: (data: X) => void; submitLabel: string })`.

No automated tests for these — this codebase has no component-testing harness
(`vitest-mock-extended`/`vitest` here cover unit/route logic only; UI is verified by manual
browser smoke per the project's existing Phase 1/2 convention). Verification is typecheck +
the Task 10 manual smoke pass.

- [ ] **Step 1: Identity step**

Create `frontend/src/components/cv/IdentityStepForm.tsx`:

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { identityStepSchema, type IdentityStep } from '@/lib/validation/cv-wizard';
import { Button, Input } from '@/components/ui';

interface IdentityStepFormProps {
  defaultValues: Partial<IdentityStep>;
  onSubmit: (data: IdentityStep) => void;
  submitLabel: string;
}

export function IdentityStepForm({ defaultValues, onSubmit, submitLabel }: IdentityStepFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IdentityStep>({
    resolver: zodResolver(identityStepSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input label="Nom complet" placeholder="Awa Ndiaye" error={errors.fullName?.message} {...register('fullName')} />
      <Input label="E-mail" type="email" placeholder="awa@example.com" error={errors.email?.message} {...register('email')} />
      <Input label="Téléphone" placeholder="+221 77 123 45 67" error={errors.phone?.message} {...register('phone')} />
      <Input label="Ville" placeholder="Dakar" error={errors.city?.message} {...register('city')} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Education step (array of entries)**

Create `frontend/src/components/cv/EducationStepForm.tsx`:

```tsx
'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { educationStepSchema, type EducationStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';

interface EducationStepFormProps {
  defaultValues: Partial<EducationStep>;
  onSubmit: (data: EducationStep) => void;
  submitLabel: string;
}

const EMPTY_ENTRY = { institution: '', degree: '', startYear: new Date().getFullYear(), endYear: null };

export function EducationStepForm({ defaultValues, onSubmit, submitLabel }: EducationStepFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EducationStep>({
    resolver: zodResolver(educationStepSchema),
    defaultValues: { entries: defaultValues.entries?.length ? defaultValues.entries : [EMPTY_ENTRY] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'entries' });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {fields.map((field, index) => (
        <Card key={field.id} bordered className="flex flex-col gap-3">
          <Input
            label="Établissement"
            placeholder="UCAD"
            error={errors.entries?.[index]?.institution?.message}
            {...register(`entries.${index}.institution`)}
          />
          <Input
            label="Diplôme / filière"
            placeholder="Licence Informatique"
            error={errors.entries?.[index]?.degree?.message}
            {...register(`entries.${index}.degree`)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Année de début"
              type="number"
              error={errors.entries?.[index]?.startYear?.message}
              {...register(`entries.${index}.startYear`, { valueAsNumber: true })}
            />
            <Input
              label="Année de fin (vide si en cours)"
              type="number"
              error={errors.entries?.[index]?.endYear?.message}
              {...register(`entries.${index}.endYear`, {
                setValueAs: (v) => (v === '' ? null : Number(v)),
              })}
            />
          </div>
          {fields.length > 1 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
              Retirer cette formation
            </Button>
          )}
        </Card>
      ))}
      <Button type="button" variant="secondary" onClick={() => append(EMPTY_ENTRY)}>
        Ajouter une formation
      </Button>
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Experience step (optional array of entries)**

Create `frontend/src/components/cv/ExperienceStepForm.tsx`:

```tsx
'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { experienceStepSchema, type ExperienceStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';

interface ExperienceStepFormProps {
  defaultValues: Partial<ExperienceStep>;
  onSubmit: (data: ExperienceStep) => void;
  submitLabel: string;
}

export function ExperienceStepForm({ defaultValues, onSubmit, submitLabel }: ExperienceStepFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ExperienceStep>({
    resolver: zodResolver(experienceStepSchema),
    defaultValues: { entries: defaultValues.entries ?? [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'entries' });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-charcoal-900/70">
        Stages, emplois, engagement associatif — ajoute ce que tu as, ou passe cette étape si tu
        n’as encore rien à ajouter.
      </p>
      {fields.map((field, index) => (
        <Card key={field.id} bordered className="flex flex-col gap-3">
          <Input
            label="Intitulé"
            placeholder="Stagiaire vente"
            error={errors.entries?.[index]?.title?.message}
            {...register(`entries.${index}.title`)}
          />
          <Input
            label="Organisation"
            placeholder="Auchan Dakar"
            error={errors.entries?.[index]?.organization?.message}
            {...register(`entries.${index}.organization`)}
          />
          <Input
            label="Description"
            placeholder="Conseil client, gestion de la caisse…"
            error={errors.entries?.[index]?.description?.message}
            {...register(`entries.${index}.description`)}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
            Retirer
          </Button>
        </Card>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => append({ title: '', organization: '', description: '' })}
      >
        Ajouter une expérience
      </Button>
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Skills step (skills list + languages)**

Create `frontend/src/components/cv/SkillsStepForm.tsx`:

```tsx
'use client';

import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { skillsStepSchema, type SkillsStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';

interface SkillsStepFormProps {
  defaultValues: Partial<SkillsStep>;
  onSubmit: (data: SkillsStep) => void;
  submitLabel: string;
}

const LANGUAGE_LEVELS = ['DEBUTANT', 'INTERMEDIAIRE', 'COURANT', 'BILINGUE', 'NATIF'] as const;
const LANGUAGE_LEVEL_LABELS: Record<(typeof LANGUAGE_LEVELS)[number], string> = {
  DEBUTANT: 'Débutant',
  INTERMEDIAIRE: 'Intermédiaire',
  COURANT: 'Courant',
  BILINGUE: 'Bilingue',
  NATIF: 'Natif',
};

export function SkillsStepForm({ defaultValues, onSubmit, submitLabel }: SkillsStepFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SkillsStep>({
    resolver: zodResolver(skillsStepSchema),
    defaultValues: {
      skills: defaultValues.skills ?? [],
      languages: defaultValues.languages ?? [],
    },
  });
  const skillsArray = useFieldArray({ control, name: 'skills' as never });
  const languagesArray = useFieldArray({ control, name: 'languages' });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-900">Compétences</span>
        {skillsArray.fields.map((field, index) => (
          <div key={field.id} className="flex gap-2">
            <Input placeholder="Excel, prise de parole…" {...register(`skills.${index}` as const)} />
            <Button type="button" variant="ghost" size="sm" onClick={() => skillsArray.remove(index)}>
              Retirer
            </Button>
          </div>
        ))}
        {errors.skills?.message && <p className="text-xs text-error-600">{errors.skills.message}</p>}
        <Button type="button" variant="secondary" size="sm" onClick={() => skillsArray.append('')}>
          Ajouter une compétence
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-900">Langues</span>
        {languagesArray.fields.map((field, index) => (
          <Card key={field.id} bordered className="flex items-end gap-3">
            <Input
              label="Langue"
              placeholder="Anglais"
              error={errors.languages?.[index]?.name?.message}
              {...register(`languages.${index}.name`)}
            />
            <Controller
              control={control}
              name={`languages.${index}.level`}
              render={({ field: levelField }) => (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-900">Niveau</label>
                  <select
                    className="h-11 rounded-xl border border-ink-900/15 bg-white px-3.5 text-sm text-charcoal-900"
                    value={levelField.value ?? 'DEBUTANT'}
                    onChange={(e) => levelField.onChange(e.target.value)}
                  >
                    {LANGUAGE_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {LANGUAGE_LEVEL_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => languagesArray.remove(index)}>
              Retirer
            </Button>
          </Card>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => languagesArray.append({ name: '', level: 'DEBUTANT' })}
        >
          Ajouter une langue
        </Button>
      </div>

      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Objective step**

Create `frontend/src/components/cv/ObjectiveStepForm.tsx`:

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { objectiveStepSchema, type ObjectiveStep } from '@/lib/validation/cv-wizard';
import { Button, Input } from '@/components/ui';

interface ObjectiveStepFormProps {
  defaultValues: Partial<ObjectiveStep>;
  onSubmit: (data: ObjectiveStep) => void;
  submitLabel: string;
}

export function ObjectiveStepForm({ defaultValues, onSubmit, submitLabel }: ObjectiveStepFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ObjectiveStep>({
    resolver: zodResolver(objectiveStepSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        label="Pays cible"
        placeholder="France, Canada, Maroc…"
        error={errors.targetCountry?.message}
        {...register('targetCountry')}
      />
      <Input
        label="Domaine d’études"
        placeholder="Informatique, Gestion, Médecine…"
        error={errors.targetField?.message}
        {...register('targetField')}
      />
      <Input
        label="Programme visé (optionnel)"
        placeholder="Master 2 Data Science"
        error={errors.targetProgram?.message}
        {...register('targetProgram')}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 6: Barrel export**

Create `frontend/src/components/cv/index.ts`:

```ts
export { IdentityStepForm } from './IdentityStepForm';
export { EducationStepForm } from './EducationStepForm';
export { ExperienceStepForm } from './ExperienceStepForm';
export { SkillsStepForm } from './SkillsStepForm';
export { ObjectiveStepForm } from './ObjectiveStepForm';
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/cv/
git commit -m "feat(cv): add 5-step wizard form components"
```

---

### Task 8: Wizard orchestration — rewrite `/cv`

**Files:**
- Modify: `frontend/src/app/cv/page.tsx` (full rewrite, currently the Phase 2 intro screen)

**Interfaces:**
- Consumes: step form components (Task 7); `ProgressBar`, `Card`, `Badge`, `Button` from
  `@/components/ui`; `api`, `ApiError` from `@/lib/api`; `WIZARD_STEPS`, `type CvAnswers`,
  `type GeneratedCv` from `@/lib/validation/cv-wizard`; the `CvPreview` component (Task 9).
- Produces: the `/cv` route — no other task consumes this directly (it's the leaf UI).

- [ ] **Step 1: Write the wizard page**

Replace the full contents of `frontend/src/app/cv/page.tsx`:

```tsx
// /cv — CV Builder: 5-step questionnaire → AI generation → printable preview.
//
// Each step auto-saves via PATCH /api/cv on "Suivant" (resumable — closing
// the tab and coming back keeps prior steps). The last step's submit calls
// POST /api/cv/generate and swaps into the preview view. Regenerating from
// the preview goes back through the same generate call.
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ProgressBar } from '@/components/ui';
import {
  IdentityStepForm,
  EducationStepForm,
  ExperienceStepForm,
  SkillsStepForm,
  ObjectiveStepForm,
} from '@/components/cv';
import { CvPreview } from '@/components/cv/CvPreview';
import { WIZARD_STEPS, type CvAnswers, type GeneratedCv, type WizardStepKey } from '@/lib/validation/cv-wizard';

interface CvDraft {
  targetCountry: string | null;
  targetField: string | null;
  answers: CvAnswers;
  generatedCv: GeneratedCv | null;
  generatedAt: string | null;
  updatedAt: string | null;
}

const STEP_LABELS: Record<WizardStepKey, string> = {
  identity: 'Identité',
  education: 'Formation',
  experience: 'Expériences',
  skills: 'Compétences & langues',
  objective: 'Objectif',
};

export default function CvBuilderPage() {
  const user = useUser();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<CvAnswers>({});
  const [generatedCv, setGeneratedCv] = useState<GeneratedCv | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<'wizard' | 'preview'>('wizard');

  useEffect(() => {
    if (!user) return;
    api<CvDraft>('/api/cv')
      .then((res) => {
        setAnswers(res.answers);
        setGeneratedCv(res.generatedCv);
        if (res.generatedCv) setView('preview');
        const firstIncomplete = WIZARD_STEPS.findIndex((step) => !res.answers[step]);
        setStepIndex(firstIncomplete === -1 ? WIZARD_STEPS.length - 1 : firstIncomplete);
      })
      .catch(() => {
        // First visit — no draft yet, wizard starts empty at step 0.
      })
      .finally(() => setLoading(false));
  }, [user]);

  async function saveStep(step: WizardStepKey, data: CvAnswers[WizardStepKey]) {
    try {
      const res = await api<CvDraft>('/api/cv', {
        method: 'PATCH',
        body: { answers: { [step]: data } },
      });
      setAnswers(res.answers);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Une erreur est survenue.', 'error');
      return false;
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api<{ generatedCv: GeneratedCv; generatedAt: string }>('/api/cv/generate', {
        method: 'POST',
      });
      setGeneratedCv(res.generatedCv);
      setView('preview');
      toast('Ton CV a été généré.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'La génération a échoué.', 'error');
    } finally {
      setGenerating(false);
    }
  }

  if (!user || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  if (view === 'preview' && generatedCv) {
    return (
      <CvPreview
        generatedCv={generatedCv}
        onEdit={() => setView('wizard')}
        onRegenerate={handleGenerate}
        regenerating={generating}
      />
    );
  }

  const currentStep = WIZARD_STEPS[stepIndex]!;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;

  async function handleStepSubmit(data: CvAnswers[typeof currentStep]) {
    const saved = await saveStep(currentStep, data);
    if (!saved) return;
    if (isLastStep) {
      await handleGenerate();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">CV Builder</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">Construis ton CV</h1>
        <ProgressBar
          className="mt-4"
          value={stepIndex + 1}
          max={WIZARD_STEPS.length}
          label={`Étape ${stepIndex + 1}/${WIZARD_STEPS.length} — ${STEP_LABELS[currentStep]}`}
        />
      </div>

      {stepIndex > 0 && (
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          className="self-start text-sm text-ink-900/70 underline underline-offset-2"
        >
          ← Étape précédente
        </button>
      )}

      {currentStep === 'identity' && (
        <IdentityStepForm
          defaultValues={answers.identity ?? {}}
          onSubmit={handleStepSubmit}
          submitLabel="Suivant"
        />
      )}
      {currentStep === 'education' && (
        <EducationStepForm
          defaultValues={answers.education ?? {}}
          onSubmit={handleStepSubmit}
          submitLabel="Suivant"
        />
      )}
      {currentStep === 'experience' && (
        <ExperienceStepForm
          defaultValues={answers.experience ?? {}}
          onSubmit={handleStepSubmit}
          submitLabel="Suivant"
        />
      )}
      {currentStep === 'skills' && (
        <SkillsStepForm
          defaultValues={answers.skills ?? {}}
          onSubmit={handleStepSubmit}
          submitLabel="Suivant"
        />
      )}
      {currentStep === 'objective' && (
        <ObjectiveStepForm
          defaultValues={answers.objective ?? {}}
          onSubmit={handleStepSubmit}
          submitLabel={generating ? 'Génération…' : 'Générer mon CV'}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: errors referencing the not-yet-created `CvPreview` — expected at this point, resolved
in Task 9. If any *other* error appears (step form prop mismatches, etc.), fix it now before
proceeding.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/cv/page.tsx
git commit -m "feat(cv): wire the 5-step wizard into /cv"
```

(This task's typecheck will fully pass once Task 9 adds `CvPreview` — that's expected and
resolved in the next task, not a blocker to committing this step's work.)

---

### Task 9: CV preview + PDF export

**Files:**
- Create: `frontend/src/components/cv/CvPreview.tsx`
- Modify: `frontend/src/app/globals.css` (add `@media print` rules)

**Interfaces:**
- Consumes: `type GeneratedCv` from `@/lib/validation/cv-wizard`; `Button` from `@/components/ui`.
- Produces: `CvPreview({ generatedCv, onEdit, onRegenerate, regenerating }: { generatedCv: GeneratedCv; onEdit: () => void; onRegenerate: () => void; regenerating: boolean })` — consumed by Task 8.

- [ ] **Step 1: Write the preview component**

Create `frontend/src/components/cv/CvPreview.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui';
import type { GeneratedCv } from '@/lib/validation/cv-wizard';

interface CvPreviewProps {
  generatedCv: GeneratedCv;
  onEdit: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

export function CvPreview({ generatedCv, onEdit, onRegenerate, regenerating }: CvPreviewProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-16">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">CV Builder</p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900">Ton CV est prêt</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}>
            Modifier mes réponses
          </Button>
          <Button variant="secondary" loading={regenerating} onClick={onRegenerate}>
            Régénérer
          </Button>
          <Button onClick={() => window.print()}>Télécharger en PDF</Button>
        </div>
      </div>

      <article id="cv-print-area" className="rounded-2xl border border-ink-900/10 bg-white p-10 shadow-sm">
        <p className="text-base leading-relaxed text-charcoal-900">{generatedCv.summary}</p>
        <div className="mt-8 flex flex-col gap-6">
          {generatedCv.sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-serif text-lg text-ink-900">{section.title}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {section.bullets.map((bullet, i) => (
                  <li key={i} className="flex gap-2 text-sm text-charcoal-900/85">
                    <span aria-hidden="true" className="text-seal-gold">
                      •
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
```

- [ ] **Step 2: Add print styles**

In `frontend/src/app/globals.css`, after the existing `@media (prefers-reduced-motion: reduce)`
block, add:

```css
@media print {
  [data-print-hide] {
    display: none !important;
  }
  body {
    background: white;
  }
  #cv-print-area {
    border: none;
    box-shadow: none;
    padding: 0;
  }
}
```

- [ ] **Step 3: Typecheck (now the full app, including Task 8's page)**

Run: `pnpm --filter frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/cv/CvPreview.tsx frontend/src/app/globals.css
git commit -m "feat(cv): add CV preview screen with print-to-PDF export"
```

---

### Task 10: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Format, lint, typecheck, test**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all four pass. Test suite should now include the new files from Tasks 2, 3, 5, 6
(cv-wizard, cv/route, generation-limiter, cv/generate/route) plus Task 4's ai/index test, all
green, on top of the existing 571+ tests.

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: succeeds; build output lists `/cv`, `/api/cv`, `/api/cv/generate` among the routes.

- [ ] **Step 3: Manual E2E smoke — full wizard with a mocked/real key**

If `ANTHROPIC_API_KEY` is not yet set in `frontend/.env.local`, this step will hit
`AI_NOT_CONFIGURED` at the final step — that's an acceptable stopping point if no key is
available yet; note it to the user rather than fabricating a key. With a key present:

1. `pnpm dev`, sign in as a test user.
2. Visit `/cv` — confirm the wizard starts at step 1 (Identité).
3. Fill and submit each of the 5 steps; after each "Suivant", confirm (via Network tab) a
   `PATCH /api/cv` fires with `answers: { <step>: {...} }`.
4. Reload the page mid-wizard (e.g. after step 3) — confirm it resumes at step 4, not step 1.
5. Submit the final "Objectif" step — confirm it calls `POST /api/cv/generate` and swaps to
   the preview screen with a summary + sections rendered.
6. Click "Télécharger en PDF" — confirm the browser print dialog opens with the app chrome
   (buttons/header) hidden and only the CV content visible in the preview pane.
7. Click "Régénérer" — confirm a new `POST /api/cv/generate` fires and the content updates.
8. Click "Modifier mes réponses" — confirm it returns to the wizard with prior answers
   pre-filled.

- [ ] **Step 4: Reduced-motion + mobile checks**

Chrome DevTools → Rendering → emulate `prefers-reduced-motion: reduce` → re-run the
`ProgressBar` step transitions — should be instant, not just faster (per the project's
existing convention). Then check the wizard and preview at 375×667 — no horizontal scroll, no
overlapping buttons, tap targets ≥44px.

- [ ] **Step 5: Rate-limit sanity check (optional, only if time permits)**

Manually call `POST /api/cv/generate` 6 times in a row (e.g. via the preview's "Régénérer")
and confirm the 6th returns 429 with the "réessaie demain" message surfaced as a toast.

- [ ] **Step 6: Report to the user**

Summarize: what was built, verification results, and explicitly flag if `ANTHROPIC_API_KEY`
was not available during this session (so generation was only tested up to
`AI_NOT_CONFIGURED`, not against a real Claude response) — this must not be silently reported
as "fully verified" if the real AI call path was never exercised end-to-end.
