import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  optionalAuth: vi.fn(),
}));

import { optionalAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockOptionalAuth = vi.mocked(optionalAuth);

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/procedures/campus-france', { method: 'GET' });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const PROCEDURE_ROW = {
  id: 'proc_1',
  slug: 'campus-france',
  name: 'Campus France',
  country: 'France',
  field: null,
  tagline: 'Candidature aux universités françaises.',
  checklist: [{ id: 'passeport-valide', title: 'Passeport en cours de validité' }],
};

describe('GET /api/procedures/[slug]', () => {
  beforeEach(() => {
    mockOptionalAuth.mockResolvedValue(null);
  });

  it('returns 404 for an unknown slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctxFor('unknown'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an archived procedure when the caller has no access', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      ...PROCEDURE_ROW,
      isArchived: true,
    } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PROCEDURE_NOT_FOUND');
  });

  it('still returns 200 for an archived procedure when the caller already holds access', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      ...PROCEDURE_ROW,
      isArchived: true,
    } as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasAccess).toBe(true);
  });

  it('omits checklist and returns hasAccess:false for an anonymous caller', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasAccess).toBe(false);
    expect(body).not.toHaveProperty('checklist');
  });

  it('omits checklist and returns hasAccess:false for an authenticated caller without access', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.hasAccess).toBe(false);
    expect(body).not.toHaveProperty('checklist');
  });

  it('includes checklist and hasAccess:true when the caller holds ProcedureAccess', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.hasAccess).toBe(true);
    expect(body.tier).toBe('SIMPLE');
    expect(body.checklist).toEqual([
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
    ]);
    expect(prismaMock.procedureAccess.findUnique).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'user-1', procedureId: 'proc_1' } },
      select: { tier: true },
    });
  });

  it('includes completPriceFcfa and upgradePriceFcfa in every response', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.completPriceFcfa).toBe(20000);
    expect(body.upgradePriceFcfa).toBe(15000);
    expect(body.priceFcfa).toBe(5000);
  });

  it('returns 500 and does not leak checklist when it fails schema validation (missing item ids)', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      ...PROCEDURE_ROW,
      checklist: [{ title: 'X' }],
    } as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('PROCEDURE_CATALOG_INVALID');
    expect(body).not.toHaveProperty('checklist');
  });

  it('marks per-item upload status when tier is COMPLET', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.findMany.mockResolvedValue([
      { checklistItemId: 'passeport-valide', filename: 'passeport.jpg' },
    ] as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.tier).toBe('COMPLET');
    expect(body.checklist).toEqual([
      {
        id: 'passeport-valide',
        title: 'Passeport en cours de validité',
        uploaded: true,
        filename: 'passeport.jpg',
      },
    ]);
  });
});
