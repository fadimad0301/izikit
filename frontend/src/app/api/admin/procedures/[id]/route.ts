// Doxi Phase 7 — GET/PATCH /api/admin/procedures/[id]. Detail (full
// checklist) + edit. priceFcfa and slug are intentionally absent from
// PatchBody — Prisma never receives them regardless of what a client
// sends, matching PATCH /api/auth/me's pattern (Phase 6).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { checklistSchema } from '@/lib/server/procedures/checklist';

const PROCEDURE_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  checklist: true,
  priceFcfa: true,
  isArchived: true,
  createdAt: true,
} as const satisfies Prisma.ProcedureSelect;

const PatchBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  field: z.string().trim().min(1).max(100).optional(),
  tagline: z.string().trim().min(1).max(300).optional(),
  checklist: checklistSchema.optional(),
  isArchived: z.boolean().optional(),
});
// No `.refine()` for "at least one field" here — Zod's object parser sets
// every unset `.optional()` shape key to literal `undefined` in its output,
// so `Object.keys(parsed.data)` inside a refine would always return all 6
// keys regardless of what the client actually sent, making that guard a
// no-op. The empty-body check instead runs on the `data` object built below
// from only the keys that are `!== undefined` — same pattern already used
// by PATCH /api/auth/me (frontend/src/app/api/auth/me/route.ts).

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { id },
      select: PROCEDURE_DETAIL_SELECT,
    });
    if (!procedure) {
      return NextResponse.json(
        { error: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    return NextResponse.json({ procedure }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Built via per-field `if (... !== undefined)` assignment, not
    // `...parsed.data` — Zod sets each unset `.optional()` key to literal
    // `undefined` in the parsed object, and exactOptionalPropertyTypes
    // rejects assigning explicit `undefined` to Prisma's optional input
    // fields. This also doubles as the "at least one field" guard: `data`
    // only gains a key when the client actually sent that field. Same
    // pattern as PATCH /api/auth/me (frontend/src/app/api/auth/me/route.ts).
    const data: Prisma.ProcedureUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.country !== undefined) data.country = parsed.data.country;
    if (parsed.data.field !== undefined) data.field = parsed.data.field;
    if (parsed.data.tagline !== undefined) data.tagline = parsed.data.tagline;
    if (parsed.data.checklist !== undefined) {
      data.checklist = parsed.data.checklist as unknown as Prisma.InputJsonValue;
    }
    if (parsed.data.isArchived !== undefined) data.isArchived = parsed.data.isArchived;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'At least one field required' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    let updated;
    try {
      updated = await prisma.procedure.update({
        where: { id },
        data,
        select: PROCEDURE_DETAIL_SELECT,
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2025') {
        return NextResponse.json(
          { error: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
          { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      throw err;
    }

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'procedure.update',
      targetType: 'Procedure',
      targetId: id,
      metadata: { fields: Object.keys(data) },
    });

    return NextResponse.json(
      { procedure: updated },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
