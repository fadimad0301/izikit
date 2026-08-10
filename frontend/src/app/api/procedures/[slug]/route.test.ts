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
  priceFcfa: 5000,
  checklist: [{ title: 'Passeport en cours de validité' }],
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
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ id: 'pa1' } as never);
    const res = await GET(makeGet(), ctxFor('campus-france'));
    const body = await res.json();
    expect(body.hasAccess).toBe(true);
    expect(body.checklist).toEqual([{ title: 'Passeport en cours de validité' }]);
    expect(prismaMock.procedureAccess.findUnique).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'user-1', procedureId: 'proc_1' } },
      select: { id: true },
    });
  });
});
