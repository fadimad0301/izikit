// Doxi — POST /api/documents/[type]/generate
//
// Pipeline mirrors /api/cv/generate: CSRF → auth → resolve type → load+
// validate answers (full schema this time, not .partial()) → AI provider
// (503 if unconfigured) → per-user-per-type rate limit (5/24h) → generate
// (502 if it throws) → persist content/generatedAt → return.
//
// The provider check runs BEFORE the rate limit on purpose — see
// /api/cv/generate's header comment for why (misconfigured deploy must not
// burn a user's daily quota on requests that never reach the AI).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { documentTypeFromSlug, documentAnswersSchemaFor } from '@/lib/validation/document-types';
import { getAiProvider } from '@/lib/server/ai';
import { createDocumentGenerationLimiter } from '@/lib/server/documents/generation-limiter';

// Module-level limiter — same convention as cv/generate/route.ts's
// module-level `limiter`: must NOT be constructed inside POST(), or a fresh
// in-memory store per request would mean hits never accumulate when Redis
// is absent.
const limiter = createDocumentGenerationLimiter(redis ? { redis } : {});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { type: slug } = await ctx.params;
    const type = documentTypeFromSlug(slug);
    if (!type) {
      return NextResponse.json(
        { error: 'DOCUMENT_TYPE_NOT_FOUND', message: 'Type de document inconnu.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const draft = await prisma.generatedDocument.findUnique({
      where: { userId_type: { userId: auth.user.sub, type } },
      select: { answers: true },
    });
    const parsedAnswers = documentAnswersSchemaFor(type).safeParse(draft?.answers ?? {});
    if (!parsedAnswers.success) {
      return NextResponse.json(
        {
          error: 'INCOMPLETE_ANSWERS',
          message: 'Réponds à toutes les questions avant de générer le document.',
          missingFields: parsedAnswers.error.issues.map((issue) => issue.path.join('.')),
        },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const ai = getAiProvider();
    if (!ai) {
      return NextResponse.json(
        { error: 'AI_NOT_CONFIGURED', message: "La génération IA n'est pas encore disponible." },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const limited = await limiter.check(auth.user.sub, type);
    if (limited) return limited;

    let content;
    try {
      content = await ai.generateDocument({ type, answers: parsedAnswers.data });
    } catch {
      return NextResponse.json(
        {
          error: 'AI_GENERATION_FAILED',
          message: 'La génération a échoué, réessaie dans un instant.',
        },
        { status: 502, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.generatedDocument.update({
      where: { userId_type: { userId: auth.user.sub, type } },
      data: {
        content: content as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
      select: { content: true, generatedAt: true },
    });

    return NextResponse.json(
      { content: updated.content, generatedAt: updated.generatedAt?.toISOString() ?? null },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
