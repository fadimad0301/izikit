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
import { GET, POST } from './route';
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
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockVerifyCsrf.mockReturnValue(null);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/procedures — list', () => {
  it('GET returns paginated procedures including archived ones', async () => {
    const active = seedProcedure({ id: 'p1', isArchived: false });
    const archived = seedProcedure({ id: 'p2', isArchived: true });
    prismaMock.procedure.findMany.mockResolvedValueOnce([active, archived] as never);

    const res = await GET(makeGet('http://test/api/admin/procedures'));
    expect(res.status).toBe(200);

    const args = prismaMock.procedure.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown> | undefined;
    expect(where?.['isArchived']).toBeUndefined();

    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('GET propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/procedures'));
    expect(res.status).toBe(403);
    expect(prismaMock.procedure.findMany).not.toHaveBeenCalled();
  });
});

describe('/api/admin/procedures — create', () => {
  const validBody = {
    name: 'Chevening',
    country: 'Royaume-Uni',
    tagline: 'Bourse Chevening pour un master au Royaume-Uni.',
    checklist: [{ id: 'passport', title: 'Copie du passeport' }],
  };

  it('POST creates a procedure with a slugified, unique slug and logs the action', async () => {
    const created = seedProcedure({ id: 'p1', slug: 'chevening', name: 'Chevening' });
    prismaMock.procedure.create.mockResolvedValueOnce({
      id: created.id,
      slug: created.slug,
    } as never);

    const res = await POST(makePost('http://test/api/admin/procedures', validBody));
    expect(res.status).toBe(201);

    const body = (await res.json()) as { procedure: { id: string; slug: string } };
    expect(body.procedure.slug).toBe('chevening');

    const createArgs = prismaMock.procedure.create.mock.calls[0]?.[0];
    expect((createArgs?.data as { slug?: string })?.slug).toBe('chevening');

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin_1',
        action: 'procedure.create',
        targetType: 'Procedure',
        targetId: 'p1',
      }),
    );
  });

  it('POST retries with a -2 suffix on slug collision', async () => {
    prismaMock.procedure.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'p2', slug: 'chevening-2' } as never);

    const res = await POST(makePost('http://test/api/admin/procedures', validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { procedure: { slug: string } };
    expect(body.procedure.slug).toBe('chevening-2');
    expect(prismaMock.procedure.create).toHaveBeenCalledTimes(2);
  });

  it('POST returns 400 VALIDATION_FAILED on an invalid checklist', async () => {
    const res = await POST(
      makePost('http://test/api/admin/procedures', { ...validBody, checklist: 'not-an-array' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.procedure.create).not.toHaveBeenCalled();
  });

  it('POST returns 400 when a required field is missing', async () => {
    const { name: _name, ...withoutName } = validBody;
    void _name;
    const res = await POST(makePost('http://test/api/admin/procedures', withoutName));
    expect(res.status).toBe(400);
    expect(prismaMock.procedure.create).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the name slugifies to an empty string', async () => {
    const res = await POST(
      makePost('http://test/api/admin/procedures', { ...validBody, name: '🎉🎉🎉' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(prismaMock.procedure.create).not.toHaveBeenCalled();
  });

  it('POST checks CSRF before requireAdmin', async () => {
    mockVerifyCsrf.mockReturnValueOnce(
      NextResponse.json({ error: 'CSRF_INVALID' }, { status: 403 }),
    );
    const res = await POST(makePost('http://test/api/admin/procedures', validBody));
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
  });
});
