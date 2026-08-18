// Doxi Phase 7 — GET/POST /api/admin/procedures. Catalog list (includes
// archived rows so an admin can unarchive) + creation. Slug is derived via
// slugify/ensureUniqueSlug (frontend/src/lib/server/slug.ts) — this is
// their first real caller in the codebase.
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
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { checklistSchema } from '@/lib/server/procedures/checklist';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';

const PROCEDURE_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  country: true,
  field: true,
  tagline: true,
  isArchived: true,
  createdAt: true,
} as const satisfies Prisma.ProcedureSelect;

const CreateBody = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(100),
  field: z.union([z.string().trim().min(1).max(100), z.literal('')]).optional(),
  tagline: z.string().trim().min(1).max(300),
  checklist: checklistSchema,
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.ProcedureWhereInput = { ...cursorWhere(cursor) };

    const rows = await prisma.procedure.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: PROCEDURE_LIST_SELECT,
    });

    return NextResponse.json(buildPage(rows, limit), {
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Corps de requête invalide.' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // ensureUniqueSlug only resolves after `create` inside the closure has
    // succeeded at least once — createdProcedure is always set by the time
    // we reach the code below. The `!` assertions reflect that invariant
    // rather than relying on cross-closure control-flow narrowing.
    let createdProcedure: { id: string; slug: string } | null = null;
    const slug = await ensureUniqueSlug(slugify(parsed.data.name), async (candidate) => {
      const created = await prisma.procedure.create({
        data: {
          name: parsed.data.name,
          country: parsed.data.country,
          // Conditional spread, not `field: parsed.data.field` — Zod's
          // `.optional()` sets the key to literal `undefined` in the parsed
          // object when absent from input, and exactOptionalPropertyTypes
          // rejects assigning explicit `undefined` to Prisma's `field?: string
          // | null` input type. Omitting the key entirely is required, not
          // just an assignment of undefined to it.
          ...(parsed.data.field !== undefined
            ? { field: parsed.data.field === '' ? null : parsed.data.field }
            : {}),
          tagline: parsed.data.tagline,
          checklist: parsed.data.checklist as unknown as Prisma.InputJsonValue,
          slug: candidate,
        },
        select: { id: true, slug: true },
      });
      createdProcedure = created;
      return created;
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'procedure.create',
      targetType: 'Procedure',
      targetId: createdProcedure!.id,
      metadata: { slug },
    });

    return NextResponse.json(
      { procedure: { id: createdProcedure!.id, slug } },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
