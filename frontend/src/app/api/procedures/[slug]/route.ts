// Doxi Phase 4/5 — GET /api/procedures/[slug]. optionalAuth so both guests
// and authenticated callers can view a procedure's name/tagline/price;
// `checklist` (the content being sold) is only included when the caller
// holds a ProcedureAccess row for it. Phase 5 adds `tier`, the Complet/
// upgrade prices, and per-item upload status when tier is COMPLET.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { optionalAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import { checklistSchema } from '@/lib/server/procedures/checklist';
import {
  PROCEDURE_SIMPLE_PRICE_FCFA,
  PROCEDURE_COMPLET_PRICE_FCFA,
  PROCEDURE_UPGRADE_PRICE_FCFA,
} from '@/lib/server/procedures/pricing';

const PROCEDURE_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  checklist: true,
} satisfies Prisma.ProcedureSelect;

type Tier = 'SIMPLE' | 'COMPLET';

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
    let tier: Tier | null = null;
    if (auth) {
      const access = await prisma.procedureAccess.findUnique({
        where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
        select: { tier: true },
      });
      tier = (access?.tier as Tier | undefined) ?? null;
    }
    const hasAccess = tier !== null;

    let uploadedByItem = new Map<string, string>();
    if (auth && tier === 'COMPLET') {
      const docs = await prisma.procedureDocument.findMany({
        where: { userId: auth.user.sub, procedureId: procedure.id },
        select: { checklistItemId: true, filename: true },
      });
      uploadedByItem = new Map(docs.map((d) => [d.checklistItemId, d.filename]));
    }

    const { checklist, ...publicFields } = procedure;
    let checklistResponse: unknown[] | undefined;
    if (hasAccess) {
      const parsedChecklist = checklistSchema.safeParse(checklist);
      if (!parsedChecklist.success) {
        log.warn('procedure checklist failed to validate — likely not re-seeded after migration', {
          procedureId: procedure.id,
          slug,
        });
        return NextResponse.json(
          {
            error: 'PROCEDURE_CATALOG_INVALID',
            message: 'Cette procédure a un problème de configuration, réessaie plus tard.',
          },
          { status: 500, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      const checklistItems = parsedChecklist.data;
      checklistResponse = checklistItems.map((item) =>
        tier === 'COMPLET'
          ? {
              ...item,
              uploaded: uploadedByItem.has(item.id),
              filename: uploadedByItem.get(item.id),
            }
          : item,
      );
    }

    return NextResponse.json(
      {
        ...publicFields,
        priceFcfa: PROCEDURE_SIMPLE_PRICE_FCFA,
        completPriceFcfa: PROCEDURE_COMPLET_PRICE_FCFA,
        upgradePriceFcfa: PROCEDURE_UPGRADE_PRICE_FCFA,
        hasAccess,
        tier,
        ...(checklistResponse ? { checklist: checklistResponse } : {}),
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
