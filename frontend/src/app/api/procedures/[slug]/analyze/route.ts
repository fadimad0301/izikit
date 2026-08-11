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
          ...(procedure.field ? { field: procedure.field } : {}),
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
