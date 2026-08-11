// Doxi Phase 4 — GET /api/procedures. Public catalog list, no auth
// required. Never selects `checklist` — that's the content being sold,
// gated behind ProcedureAccess in GET /api/procedures/[slug] (Task 5).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { PROCEDURE_SIMPLE_PRICE_FCFA } from '@/lib/server/procedures/pricing';

const PROCEDURE_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
} satisfies Prisma.ProcedureSelect;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const procedures = await prisma.procedure.findMany({
      select: PROCEDURE_LIST_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    const withPrice = procedures.map((p) => ({ ...p, priceFcfa: PROCEDURE_SIMPLE_PRICE_FCFA }));

    return NextResponse.json(withPrice, {
      status: 200,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}
