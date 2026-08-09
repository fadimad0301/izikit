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
import {
  cvAnswersSchema,
  generatedCvSchema,
  type CvAnswers,
  type GeneratedCv,
} from '@/lib/validation/cv-wizard';

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
