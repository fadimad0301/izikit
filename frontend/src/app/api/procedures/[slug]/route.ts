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
