import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);

function makeReq(): NextRequest {
  return new NextRequest('http://test/api/procedures/mine', { method: 'GET' });
}

const AUTHED = { user: { sub: 'user-1', email: 'me@example.com' } };

const CHECKLIST_2_ITEMS = [
  { id: 'passeport-valide', title: 'Passeport en cours de validité' },
  { id: 'lettre-motivation', title: 'Lettre de motivation' },
];

describe('GET /api/procedures/mine', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(AUTHED as never);
  });

  it('Test 1: not authenticated — 401', async () => {
    mockRequireAuth.mockResolvedValue(new NextResponse(null, { status: 401 }) as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('Test 2: no purchases — empty array', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaMock.procedureDocument.groupBy as any).mockResolvedValue([]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('Test 3: SIMPLE tier — documentsUploaded is null', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'SIMPLE',
        grantedAt: new Date('2026-08-01T00:00:00.000Z'),
        procedureId: 'proc_1',
        procedure: {
          slug: 'campus-france',
          name: 'Campus France',
          country: 'France',
          field: null,
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaMock.procedureDocument.groupBy as any).mockResolvedValue([]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toEqual([
      {
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tier: 'SIMPLE',
        checklistTotal: 2,
        documentsUploaded: null,
        grantedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('Test 4: COMPLET tier, partial uploads', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'COMPLET',
        grantedAt: new Date('2026-08-02T00:00:00.000Z'),
        procedureId: 'proc_2',
        procedure: {
          slug: 'chevening',
          name: 'Chevening',
          country: 'Royaume-Uni',
          field: 'Master',
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaMock.procedureDocument.groupBy as any).mockResolvedValue([
      { procedureId: 'proc_2', _count: { _all: 1 } },
    ]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body[0]).toMatchObject({
      tier: 'COMPLET',
      checklistTotal: 2,
      documentsUploaded: 1,
    });
  });

  it('Test 5: COMPLET tier, all documents uploaded', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'COMPLET',
        grantedAt: new Date('2026-08-03T00:00:00.000Z'),
        procedureId: 'proc_3',
        procedure: {
          slug: 'bourse-canada',
          name: 'Bourse Canada',
          country: 'Canada',
          field: null,
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaMock.procedureDocument.groupBy as any).mockResolvedValue([
      { procedureId: 'proc_3', _count: { _all: 2 } },
    ]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body[0]).toMatchObject({ documentsUploaded: 2, checklistTotal: 2 });
  });

  it('Test 6: malformed checklist is skipped, other purchases still returned', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'SIMPLE',
        grantedAt: new Date('2026-08-04T00:00:00.000Z'),
        procedureId: 'proc_bad',
        procedure: {
          slug: 'broken',
          name: 'Broken',
          country: 'X',
          field: null,
          checklist: 'not-an-array',
        },
      },
      {
        tier: 'SIMPLE',
        grantedAt: new Date('2026-08-01T00:00:00.000Z'),
        procedureId: 'proc_ok',
        procedure: {
          slug: 'campus-france',
          name: 'Campus France',
          country: 'France',
          field: null,
          checklist: CHECKLIST_2_ITEMS,
        },
      },
    ] as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaMock.procedureDocument.groupBy as any).mockResolvedValue([]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe('campus-france');
  });
});
