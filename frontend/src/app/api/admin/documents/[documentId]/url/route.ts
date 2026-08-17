// Doxi Phase 7 — GET /api/admin/documents/[documentId]/url. Mints a
// short-lived signed Cloudinary URL for one ProcedureDocument so any ADMIN
// can review an uploaded passport/transcript/etc. Access is open to every
// ADMIN (not SUPERADMIN-only, per the approved Phase 7 design) — every call
// is logged via logAdminAction as the substitute control.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getSignedDeliveryUrl } from '@/lib/server/upload/cloudinary-client';

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { documentId } = await ctx.params;
    const doc = await prisma.procedureDocument.findUnique({
      where: { id: documentId },
      select: { id: true, userId: true, cloudinaryPublicId: true, resourceType: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const url = getSignedDeliveryUrl(doc.cloudinaryPublicId, doc.resourceType, expiresAt);

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'document.view',
      targetType: 'ProcedureDocument',
      targetId: doc.id,
      metadata: { ownerUserId: doc.userId },
    });

    return NextResponse.json(
      { url, expiresAt: new Date(expiresAt * 1000).toISOString() },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
