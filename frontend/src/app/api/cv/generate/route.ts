// Doxi — POST /api/cv/generate
//
// Pipeline: CSRF → auth → load+validate answers (all 5 steps required) →
// AI provider (503 if unconfigured) → per-user rate limit (5/24h) →
// generate (502 if it throws) → persist generatedCv/generatedAt → return.
//
// The provider check runs BEFORE the rate limit on purpose: a misconfigured
// deploy (no ANTHROPIC_API_KEY) must not burn a user's daily quota for
// requests that never reach the AI at all.
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
const limiter = createGenerationLimiter(redis ? { redis } : {});

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

    const ai = getAiProvider();
    if (!ai) {
      return NextResponse.json(
        { error: 'AI_NOT_CONFIGURED', message: "La génération IA n'est pas encore disponible." },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const limited = await limiter.check(auth.user.sub);
    if (limited) return limited;

    let generatedCv;
    try {
      generatedCv = await ai.generateCv({ answers });
    } catch {
      return NextResponse.json(
        {
          error: 'AI_GENERATION_FAILED',
          message: 'La génération a échoué, réessaie dans un instant.',
        },
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
