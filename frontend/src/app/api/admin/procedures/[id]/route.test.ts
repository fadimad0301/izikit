import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { verifyCsrf } from '@/lib/server/auth';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { GET, PATCH } from './route';
import { seedAdmin, seedProcedure } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}
function makePatch(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockVerifyCsrf.mockReturnValue(null);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/procedures/[id] — detail', () => {
  it('GET returns the full procedure including checklist', async () => {
    const proc = seedProcedure({ id: 'p1' });
    prismaMock.procedure.findUnique.mockResolvedValueOnce(proc as never);

    const res = await GET(makeGet('http://test/api/admin/procedures/p1'), params('p1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { procedure: { checklist: unknown } };
    expect(body.procedure.checklist).toEqual(proc.checklist);
  });

  it('GET returns 404 PROCEDURE_NOT_FOUND for an unknown id', async () => {
    prismaMock.procedure.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeGet('http://test/api/admin/procedures/missing'), params('missing'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROCEDURE_NOT_FOUND');
  });
});

describe('/api/admin/procedures/[id] — edit', () => {
  it('PATCH updates a single field and logs only the field name', async () => {
    const proc = seedProcedure({ id: 'p1' });
    prismaMock.procedure.update.mockResolvedValueOnce({
      ...proc,
      tagline: 'Nouvelle accroche.',
    } as never);

    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/p1', { tagline: 'Nouvelle accroche.' }),
      params('p1'),
    );
    expect(res.status).toBe(200);

    const updateArgs = prismaMock.procedure.update.mock.calls[0]?.[0];
    const data = updateArgs?.data as Record<string, unknown>;
    expect(data['tagline']).toBe('Nouvelle accroche.');
    expect(data['priceFcfa']).toBeUndefined();
    expect(data['slug']).toBeUndefined();

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'procedure.update',
        targetType: 'Procedure',
        targetId: 'p1',
        metadata: { fields: ['tagline'] },
      }),
    );
  });

  it('PATCH updates isArchived alone (archive toggle)', async () => {
    const proc = seedProcedure({ id: 'p1', isArchived: false });
    prismaMock.procedure.update.mockResolvedValueOnce({ ...proc, isArchived: true } as never);

    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/p1', { isArchived: true }),
      params('p1'),
    );
    expect(res.status).toBe(200);
    const updateArgs = prismaMock.procedure.update.mock.calls[0]?.[0];
    expect((updateArgs?.data as Record<string, unknown>)['isArchived']).toBe(true);
  });

  it('PATCH ignores priceFcfa/slug even if sent — DB value is untouched', async () => {
    const proc = seedProcedure({ id: 'p1', priceFcfa: 5000, slug: 'campus-france' });
    prismaMock.procedure.update.mockResolvedValueOnce(proc as never);

    await PATCH(
      makePatch('http://test/api/admin/procedures/p1', {
        tagline: 'X',
        priceFcfa: 999999,
        slug: 'hacked-slug',
      }),
      params('p1'),
    );

    const updateArgs = prismaMock.procedure.update.mock.calls[0]?.[0];
    const data = updateArgs?.data as Record<string, unknown>;
    expect(data['priceFcfa']).toBeUndefined();
    expect(data['slug']).toBeUndefined();
    expect(data['tagline']).toBe('X');
  });

  it('PATCH with an empty body returns 400', async () => {
    const res = await PATCH(makePatch('http://test/api/admin/procedures/p1', {}), params('p1'));
    expect(res.status).toBe(400);
    expect(prismaMock.procedure.update).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 for an unknown id', async () => {
    prismaMock.procedure.update.mockRejectedValueOnce({ code: 'P2025' });
    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/missing', { tagline: 'X' }),
      params('missing'),
    );
    expect(res.status).toBe(404);
  });

  it('PATCH checks CSRF before requireAdmin', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'CSRF_INVALID' }, { status: 403 }),
    );
    const res = await PATCH(
      makePatch('http://test/api/admin/procedures/p1', { tagline: 'X' }),
      params('p1'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
  });
});
