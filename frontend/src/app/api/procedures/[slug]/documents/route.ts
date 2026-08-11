// Doxi Phase 5 — POST /api/procedures/[slug]/documents. Complet-tier only:
// uploads one file per checklist item. Stored with Cloudinary's
// `authenticated` delivery type (never publicly reachable) — the only way
// to read it back is GET .../documents/[itemId]/url (signed, 5-minute TTL).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import {
  StorageNotConfiguredError,
  uploadAuthenticatedBuffer,
} from '@/lib/server/upload/cloudinary-client';
import { sanitizeFilename } from '@/lib/server/upload/sanitize-filename';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';
import type { ChecklistItem } from '@/lib/server/procedures/checklist';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { slug } = await ctx.params;
    const procedure = await prisma.procedure.findUnique({
      where: { slug },
      select: { id: true, checklist: true },
    });
    if (!procedure) {
      return NextResponse.json(
        { code: 'PROCEDURE_NOT_FOUND', message: 'Procédure introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const access = await prisma.procedureAccess.findUnique({
      where: { userId_procedureId: { userId: auth.user.sub, procedureId: procedure.id } },
      select: { tier: true },
    });
    if (access?.tier !== 'COMPLET') {
      return NextResponse.json(
        { code: 'COMPLET_REQUIRED', message: 'L’offre Complet est requise pour cette action.' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const allowedMime = (process.env.UPLOAD_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const maxBytes = Number.parseInt(process.env.UPLOAD_MAX_BYTES ?? '10485760', 10);

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const form = await req.formData();
    const checklistItemId = form.get('checklistItemId');
    if (typeof checklistItemId !== 'string' || checklistItemId.length === 0) {
      return NextResponse.json(
        { code: 'MISSING_CHECKLIST_ITEM_ID', message: 'checklistItemId is required' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    const checklistItems = procedure.checklist as unknown as ChecklistItem[];
    if (!checklistItems.some((item) => item.id === checklistItemId)) {
      return NextResponse.json(
        { code: 'UNKNOWN_CHECKLIST_ITEM', message: 'Item de checklist inconnu.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: 'UPLOAD_MISSING_FILE', message: 'file field is required' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (file.size > maxBytes) {
      return NextResponse.json(
        { code: 'FILE_TOO_LARGE', message: `Max ${maxBytes} bytes` },
        { status: 413, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (!allowedMime.includes(file.type)) {
      return NextResponse.json(
        { code: 'INVALID_MIME', message: `MIME ${file.type} not allowed` },
        { status: 415, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { code: 'MAGIC_BYTE_MISMATCH', message: 'File bytes do not match declared MIME' },
        { status: 415, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const storedFilename = sanitizeFilename(file.name);
    const publicId = `procedures/${auth.user.sub}/${procedure.id}/${checklistItemId}`;

    let uploaded;
    try {
      uploaded = await uploadAuthenticatedBuffer(publicId, buf, file.type);
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
          { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      return NextResponse.json(
        { code: 'UPLOAD_FAILED', message: 'Storage write failed' },
        { status: 502, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const row = await prisma.procedureDocument.upsert({
      where: {
        userId_procedureId_checklistItemId: {
          userId: auth.user.sub,
          procedureId: procedure.id,
          checklistItemId,
        },
      },
      create: {
        userId: auth.user.sub,
        procedureId: procedure.id,
        checklistItemId,
        cloudinaryPublicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        filename: storedFilename,
        mimeType: file.type,
        sizeBytes: uploaded.bytes,
      },
      update: {
        cloudinaryPublicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        filename: storedFilename,
        mimeType: file.type,
        sizeBytes: uploaded.bytes,
      },
      select: { checklistItemId: true, filename: true },
    });

    return NextResponse.json(
      { checklistItemId: row.checklistItemId, filename: row.filename, uploaded: true },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
