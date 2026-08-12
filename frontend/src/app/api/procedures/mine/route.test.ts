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
    prismaMock.procedureDocument.findMany.mockResolvedValue([]);
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
    prismaMock.procedureDocument.findMany.mockResolvedValue([]);
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
    prismaMock.procedureDocument.findMany.mockResolvedValue([
      { procedureId: 'proc_2', checklistItemId: 'passeport-valide' },
    ] as never);
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
    prismaMock.procedureDocument.findMany.mockResolvedValue([
      { procedureId: 'proc_3', checklistItemId: 'passeport-valide' },
      { procedureId: 'proc_3', checklistItemId: 'lettre-motivation' },
    ] as never);
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
    prismaMock.procedureDocument.findMany.mockResolvedValue([]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe('campus-france');
  });

  it('Test 7: checklist re-seeded — stale uploaded row does not count, only items still present in the current checklist count', async () => {
    prismaMock.procedureAccess.findMany.mockResolvedValue([
      {
        tier: 'COMPLET',
        grantedAt: new Date('2026-08-05T00:00:00.000Z'),
        procedureId: 'proc_4',
        procedure: {
          slug: 'campus-france',
          name: 'Campus France',
          country: 'France',
          field: null,
          // Checklist was re-seeded down to a single, different item.
          checklist: [{ id: 'lettre-motivation', title: 'Lettre de motivation' }],
        },
      },
    ] as never);
    // User has 2 uploaded rows: one for a stale item no longer in the checklist
    // ('passeport-valide'), one for the current item ('lettre-motivation').
    prismaMock.procedureDocument.findMany.mockResolvedValue([
      { procedureId: 'proc_4', checklistItemId: 'passeport-valide' },
      { procedureId: 'proc_4', checklistItemId: 'lettre-motivation' },
    ] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    // Must NOT return the raw row count of 2 — only the item still present
    // in the current checklist counts.
    expect(body[0]).toMatchObject({ documentsUploaded: 1, checklistTotal: 1 });
  });
});
