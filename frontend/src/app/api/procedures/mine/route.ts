// Doxi Phase 6 — GET /api/procedures/mine. Lists the authenticated user's purchased
// procedures with their tier and (for COMPLET) document-upload progress, for the
// "Mes procédures" section of /settings.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import { checklistSchema } from '@/lib/server/procedures/checklist';

interface MyProcedure {
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tier: 'SIMPLE' | 'COMPLET';
  checklistTotal: number;
  documentsUploaded: number | null;
  grantedAt: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) {
      auth.headers.set('x-request-id', ctx.requestId);
      return auth;
    }

    const accesses = await prisma.procedureAccess.findMany({
      where: { userId: auth.user.sub },
      orderBy: { grantedAt: 'desc' },
      select: {
        tier: true,
        grantedAt: true,
        procedureId: true,
        procedure: {
          select: { slug: true, name: true, country: true, field: true, checklist: true },
        },
      },
    });

    const completIds = accesses.filter((a) => a.tier === 'COMPLET').map((a) => a.procedureId);
    const counts =
      completIds.length > 0
        ? await prisma.procedureDocument.groupBy({
            by: ['procedureId'],
            where: { userId: auth.user.sub, procedureId: { in: completIds } },
            _count: { _all: true },
          })
        : [];
    const uploadedByProcedureId = new Map(counts.map((c) => [c.procedureId, c._count._all]));

    const result: MyProcedure[] = [];
    for (const access of accesses) {
      const parsedChecklist = checklistSchema.safeParse(access.procedure.checklist);
      if (!parsedChecklist.success) {
        log.warn('procedure checklist failed to validate — skipped from /mine list', {
          procedureId: access.procedureId,
          slug: access.procedure.slug,
        });
        continue;
      }
      const tier = access.tier as 'SIMPLE' | 'COMPLET';
      result.push({
        slug: access.procedure.slug,
        name: access.procedure.name,
        country: access.procedure.country,
        field: access.procedure.field,
        tier,
        checklistTotal: parsedChecklist.data.length,
        documentsUploaded:
          tier === 'COMPLET' ? (uploadedByProcedureId.get(access.procedureId) ?? 0) : null,
        grantedAt: access.grantedAt.toISOString(),
      });
    }

    return NextResponse.json(result, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}
