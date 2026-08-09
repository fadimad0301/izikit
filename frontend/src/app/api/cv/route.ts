// Doxi — GET + PATCH /api/cv
//
// One in-progress CV draft per user (`CvProfile`, unique on userId). GET
// returns the current draft (or nulls if none started yet). PATCH upserts
// a partial update — same last-write-wins semantic as notifications/prefs,
// not worth a Serializable transaction for a single-user draft.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PatchBody = z.object({
  targetCountry: z.string().min(1).max(100).optional(),
  targetField: z.string().min(1).max(100).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const draft = await prisma.cvProfile.findUnique({
      where: { userId: auth.user.sub },
      select: { targetCountry: true, targetField: true, updatedAt: true },
    });

    return NextResponse.json(
      {
        targetCountry: draft?.targetCountry ?? null,
        targetField: draft?.targetField ?? null,
        updatedAt: draft?.updatedAt ?? null,
      },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
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

    // Built with narrowed conditional assignment rather than spreading
    // `parsed.data` directly — exactOptionalPropertyTypes rejects an
    // explicit `string | undefined` flowing into Prisma's `string | null`
    // input types, even though the key would be omitted at runtime either way.
    // Separate create/update objects because Prisma's generated Update input
    // type (which allows FieldUpdateOperationsInput) isn't structurally
    // assignable into the Create input type.
    const { targetCountry, targetField } = parsed.data;

    const createData: Prisma.CvProfileUncheckedCreateInput = { userId: auth.user.sub };
    if (targetCountry !== undefined) createData.targetCountry = targetCountry;
    if (targetField !== undefined) createData.targetField = targetField;

    const updateData: Prisma.CvProfileUncheckedUpdateInput = {};
    if (targetCountry !== undefined) updateData.targetCountry = targetCountry;
    if (targetField !== undefined) updateData.targetField = targetField;

    const draft = await prisma.cvProfile.upsert({
      where: { userId: auth.user.sub },
      create: createData,
      update: updateData,
      select: { targetCountry: true, targetField: true, updatedAt: true },
    });

    return NextResponse.json(draft, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}
