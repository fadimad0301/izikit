// Doxi Phase 4 — GET /api/orders/[id]. Owner-only lookup, generic to the
// Order flow (not procedure-specific) — the extension point for any future
// payment-return page, not just Phase 4's. 404 (not 403) for a foreign
// order to avoid revealing that an order id exists.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { sanitizeMetadata } from '@/lib/server/orders/sanitize-metadata';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const order = await prisma.order.findUnique({
      where: { id },
      select: { userId: true, status: true, amount: true, currency: true, metadata: true },
    });
    if (!order || order.userId !== auth.user.sub) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    return NextResponse.json(
      {
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        metadata: sanitizeMetadata(order.metadata),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
