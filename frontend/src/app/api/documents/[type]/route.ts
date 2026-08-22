// Doxi — GET + PATCH /api/documents/[type]
//
// One in-progress draft per (user, document type) — same shape as
// GET/PATCH /api/cv. `type` in the URL is the kebab-case slug from
// DOCUMENT_TYPE_SLUGS (e.g. "cover-letter"); 404s on an unknown slug before
// touching the DB. PATCH replaces the whole `answers` blob for that type —
// unlike /api/cv (which merges per wizard step), a document's answers are a
// single flat form, so a full replace is the right semantic here.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import {
  documentTypeFromSlug,
  documentAnswersSchemaFor,
  generatedDocumentSchema,
  type GeneratedDocumentContent,
} from '@/lib/validation/document-types';

const DOCUMENT_SELECT = {
  answers: true,
  content: true,
  generatedAt: true,
  updatedAt: true,
} satisfies Prisma.GeneratedDocumentSelect;

type DocumentRow = {
  answers: Prisma.JsonValue;
  content: Prisma.JsonValue | null;
  generatedAt: Date | null;
  updatedAt: Date;
} | null;

function parseContent(raw: Prisma.JsonValue | null | undefined): GeneratedDocumentContent | null {
  if (raw === null || raw === undefined) return null;
  const parsed = generatedDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function serialize(row: DocumentRow) {
  return {
    answers: row?.answers && typeof row.answers === 'object' ? row.answers : {},
    content: parseContent(row?.content),
    generatedAt: row?.generatedAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
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
      select: DOCUMENT_SELECT,
    });

    return NextResponse.json(serialize(draft), {
      status: 200,
      headers: { 'x-request-id': reqCtx.requestId },
    });
  });
}

export async function PATCH(
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

    const body = await req.json().catch(() => null);
    // Partial validation: a draft in progress may not have every required
    // field filled in yet (student saves as they go). Full requiredness is
    // enforced at generate-time, not save-time — same relationship as
    // cv-wizard's per-step schemas vs. the generate route's completeness check.
    const parsed = documentAnswersSchemaFor(type)
      .partial()
      .safeParse(body?.answers ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const draft = await prisma.generatedDocument.upsert({
      where: { userId_type: { userId: auth.user.sub, type } },
      create: {
        userId: auth.user.sub,
        type,
        answers: parsed.data as unknown as Prisma.InputJsonValue,
      },
      update: {
        answers: parsed.data as unknown as Prisma.InputJsonValue,
      },
      select: DOCUMENT_SELECT,
    });

    return NextResponse.json(serialize(draft), {
      status: 200,
      headers: { 'x-request-id': reqCtx.requestId },
    });
  });
}
