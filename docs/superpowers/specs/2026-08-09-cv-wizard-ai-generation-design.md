# Doxi — Phase 3: CV Builder wizard + AI generation

**Status:** Approved — proceeding to implementation plan
**Date:** 2026-08-09

## Context

Phase 1 (auth screens, design tokens, base UI components) and Phase 2 (landing page,
`CvProfile` model, `/api/cv` GET/PATCH, `/cv` intro screen capturing `targetCountry`/
`targetField`) are complete and verified. Phase 3 replaces the `/cv` intro screen with the
real 5-step CV questionnaire and adds AI-assisted CV generation via Claude, per the Doxi
brief's phased build order and the roadmap sketch in the Phase 1 plan
(`C:\Users\fadim\.claude\plans\doxi-brief-cozy-kite.md`).

**Confirmed decisions carried over from Phase 1 planning (do not re-litigate):**
- Stack stays Prisma + Neon + custom JWT auth.
- AI provider: Claude (Anthropic) via `@anthropic-ai/sdk`, behind an `AiProvider` abstraction
  in `frontend/src/lib/server/ai/`, mirroring the existing `PaymentProvider` pattern.
- CV Builder tier is free — no payment gating in this phase.

**Decisions made in this brainstorming session:**
- Wizard content: standard 5-step CV structure (no original brief detail survived
  compaction) — Identity, Education, Experience, Skills & languages, Objective.
- Output: on-screen structured preview + PDF export via browser print (`window.print()` +
  `@media print` CSS) — no new server-side PDF dependency.
- AI role: professional rewrite of the student's raw input into polished CV bullets, adapted
  to target country/field — **must not invent facts** the student didn't provide.
- Cost control: 5 generations/regenerations per user per 24h, enforced server-side.

## Data model

Extend `CvProfile` (no new model — the existing schema comment already anticipates this):

```prisma
model CvProfile {
  id            String    @id @default(cuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  targetCountry String?
  targetField   String?
  answers       Json      @default("{}")   // { identity, education[], experience[], skills, objective }
  generatedCv   Json?                       // last AI-generated structured CV
  generatedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

`answers` stays an untyped JSON blob at the DB layer (shape owned by the wizard, per the
existing schema comment). Shape is enforced by Zod on the app side:
`frontend/src/lib/validation/cv-wizard.ts` — one schema per step:

1. **Identity** — name, contact, city
2. **Education** — array of `{ institution, degree, startYear, endYear }`
3. **Experience** — array of `{ title, org, description }` (stages/emplois/associatif, free text)
4. **Skills** — skills list + languages with proficiency
5. **Objective** — target country/field/program (pre-filled from `targetCountry`/`targetField`)

A combined `cvAnswersSchema` (all steps optional/partial) backs `PATCH /api/cv`.

## `/api/cv` — extended PATCH semantics

`PATCH /api/cv` (existing route, already `requireAuth` + `verifyCsrf`) accepts an additional
optional `answers` field: `{ [step: string]: unknown }`. Server does a **shallow merge per
step key** — `answers = { ...current.answers, ...parsed.data.answers }` — so submitting one
step never clobbers the others. Same last-write-wins semantic already documented for this
route; still not worth a transaction.

The wizard calls this on every "Suivant" — auto-save per step, resumable if the student closes
the tab.

## AI module — `frontend/src/lib/server/ai/`

Mirrors `frontend/src/lib/server/payments/provider.ts`:

```ts
// provider.ts
export interface CvGenerationInput {
  answers: CvAnswers; // validated, from cv-wizard.ts schemas
}

export interface GeneratedCvSection {
  title: string;
  bullets: string[];
}

export interface GeneratedCv {
  summary: string;
  sections: GeneratedCvSection[];
}

export interface AiProvider {
  name: string;
  generateCv(input: CvGenerationInput): Promise<GeneratedCv>;
}
```

`claude.ts` — concrete implementation via `@anthropic-ai/sdk`. System prompt constraints:
- Rewrite the student's raw entries into professional, concise CV bullets.
- Adapt tone/emphasis to the target country and field from `answers.objective`.
- **Never invent facts, dates, employers, or credentials not present in `answers`.**
- Output validated against the `GeneratedCv` shape (JSON mode / tool-call structured output).

`index.ts` — factory: returns `null` when `ANTHROPIC_API_KEY` is absent (mirrors
`redis.ts`'s `Redis | null` pattern referenced in CLAUDE.md) rather than throwing; the route
returns 503 `AI_NOT_CONFIGURED` in that case, consistent with how Cloudinary/Resend degrade.

## `POST /api/cv/generate`

New route, `runtime = 'nodejs'`, `requireAuth` + `verifyCsrf`.

1. Load `CvProfile.answers`; validate required steps are present → else 400
   `INCOMPLETE_PROFILE`.
2. Rate-limit: 5 requests / 24h per user. Reuses the `RateLimitStore` primitives from
   `rate-limit-store.ts` (`RedisRateLimitStore` / `MemoryRateLimitStore` — same classes
   `rate-limit-by-email.ts` consumes), keyed by `cv-generate:<userId>` instead of email. This
   is a new small helper, not an edit to the protected `rate-limit-store.ts` file itself.
   Exceeded → 429 with a clear message ("Tu as atteint la limite de 5 générations
   aujourd'hui, réessaie demain").
3. Call `ai.generateCv({ answers })`. Provider absent → 503 `AI_NOT_CONFIGURED`. Provider
   error/timeout → 502 `AI_GENERATION_FAILED` (wizard answers are untouched in DB either way
   — nothing is lost on failure).
4. On success: persist `generatedCv` + `generatedAt` on `CvProfile`, return the generated CV.

Regeneration (a "Régénérer" button on the preview screen) hits the same endpoint and consumes
the same quota.

## UI — wizard + preview

`/cv` (`frontend/src/app/cv/page.tsx`) is replaced by the real 5-step wizard, built on Phase
1's component set:
- `ProgressBar` for step indicator
- RHF + `zodResolver` per step (one of the 5 schemas), matching the auth-screen pattern
- "Suivant"/"Précédent" navigation; "Suivant" triggers the per-step `PATCH /api/cv`
- Last step ("Objectif") ends with "Générer mon CV" → `POST /api/cv/generate`

**Preview screen**: a client-side view swap within the same `/cv` route (local component
state, not a new route) — the wizard and the preview are two rendering modes of one page, so
regenerating or going back to edit an answer doesn't round-trip through routing. Renders
`generatedCv` in an HTML/CSS CV template using Doxi tokens (`--font-serif` for headings).
"Télécharger en PDF" triggers
`window.print()`; a dedicated `@media print` stylesheet hides app chrome (header/nav/buttons)
and paginates the template cleanly. Works on mobile Chrome (native "Save as PDF" in the print
sheet).

## Error handling summary

| Condition | Response | UX |
|---|---|---|
| Missing required wizard steps | 400 `INCOMPLETE_PROFILE` | Redirect to first incomplete step |
| Rate limit exceeded | 429 `CV_GENERATION_RATE_LIMITED` | Toast with retry-tomorrow message |
| AI provider not configured | 503 `AI_NOT_CONFIGURED` | Toast: feature temporarily unavailable |
| AI call fails/times out | 502 `AI_GENERATION_FAILED` | Toast: retry; wizard answers preserved |

## Testing

- Unit tests for `cv-wizard.ts` Zod schemas (valid/invalid per step).
- Unit tests for `/api/cv` PATCH merge semantics (partial `answers` update doesn't clobber
  other steps).
- Unit tests for `/api/cv/generate`: `INCOMPLETE_PROFILE`, rate-limit 429 after 5 hits,
  `AI_NOT_CONFIGURED` when provider factory returns null, success path persists
  `generatedCv`/`generatedAt` (mock `AiProvider`, no real Anthropic calls in tests).
- Manual E2E smoke: fill all 5 steps → generate → preview renders → print dialog opens;
  reduced-motion + 375px checks on the wizard per existing project convention.

## Explicitly out of scope for this phase

- Multiple named/saved CVs (still a single draft per user, per the existing `CvProfile`
  schema comment).
- Server-side PDF generation (Puppeteer/React-PDF) — deferred unless browser-print proves
  insufficient.
- Procedure/checklist selection and paid tiers — Phase 4.
