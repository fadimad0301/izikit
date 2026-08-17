import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/procedures', { method: 'GET' });
}

describe('GET /api/procedures', () => {
  it('returns the procedure list without leaking checklist content', async () => {
    prismaMock.procedure.findMany.mockResolvedValue([
      {
        id: 'proc_1',
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tagline: 'Candidature aux universités françaises.',
      },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'proc_1',
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tagline: 'Candidature aux universités françaises.',
        priceFcfa: 5000,
      },
    ]);
    expect(body[0]).not.toHaveProperty('checklist');

    expect(prismaMock.procedure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ checklist: true, priceFcfa: true }),
      }),
    );
  });

  it('returns an empty array when no procedures exist', async () => {
    prismaMock.procedure.findMany.mockResolvedValue([]);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('excludes archived procedures via the where clause', async () => {
    prismaMock.procedure.findMany.mockResolvedValue([
      {
        id: 'proc_1',
        slug: 'campus-france',
        name: 'Campus France',
        country: 'France',
        field: null,
        tagline: 'Candidature aux universités françaises.',
      },
    ] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);

    expect(prismaMock.procedure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isArchived: false },
      }),
    );
  });
});
