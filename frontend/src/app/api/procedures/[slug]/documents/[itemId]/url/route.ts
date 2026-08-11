// Doxi Phase 5 — GET /api/procedures/[slug]/documents/[itemId]/url. The
// only path to a procedure document's bytes: mints a Cloudinary signed URL
// with a 300s TTL on every call, never persisted. 404 (not 403) whether the
// procedure/document doesn't exist or the caller isn't Complet-tier — same
// convention as every other non-owned-resource lookup in this codebase.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getSignedDeliveryUrl } from '@/lib/server/upload/cloudinary-client';

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; itemId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) return auth;

    const { slug, itemId } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!procedure) {
      return NextResponse.json(
        { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const access = await prisma.procedureAccess.findUnique({
      where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
      select: { tier: true },
    });
    if (access?.tier !== 'COMPLET') {
      return NextResponse.json(
        { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const doc = await prisma.procedureDocument.findUnique({
      where: {
        userId_procedureId_checklistItemId: {
          userId: auth.user.sub,
          procedureId: procedure.id,
          checklistItemId: itemId,
        },
      },
      select: { cloudinaryPublicId: true, resourceType: true },
    });
    if (!doc) {
      return NextResponse.json(
        { code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const url = getSignedDeliveryUrl(doc.cloudinaryPublicId, doc.resourceType, expiresAt);

    return NextResponse.json(
      { url, expiresAt: new Date(expiresAt * 1000).toISOString() },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
