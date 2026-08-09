// Mock strategy mirrors src/app/api/upload/route.test.ts — requireAuth/verifyCsrf
// stubbed happy by default, prisma.cvProfile mocked so no real DB is hit.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

const cvProfileFindUnique = vi.fn();
const cvProfileUpsert = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: {
    cvProfile: {
      findUnique: (...args: unknown[]) => cvProfileFindUnique(...args),
      upsert: (...args: unknown[]) => cvProfileUpsert(...args),
    },
  },
}));

function makeReq(method: string, body?: unknown) {
  return new Request(new URL('http://localhost/api/cv'), {
    method,
    headers: { 'x-csrf-token': 'test-csrf', 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/cv', () => {
  it('returns nulls/empty answers when no draft exists', async () => {
    cvProfileFindUnique.mockResolvedValueOnce(null);
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      targetCountry: null,
      targetField: null,
      answers: {},
      generatedCv: null,
      generatedAt: null,
      updatedAt: null,
    });
  });

  it('returns the stored draft', async () => {
    const updatedAt = new Date('2026-08-09T12:00:00.000Z');
    cvProfileFindUnique.mockResolvedValueOnce({
      targetCountry: 'France',
      targetField: 'Informatique',
      answers: {
        identity: {
          fullName: 'Awa',
          email: 'awa@example.com',
          phone: '+221771234567',
          city: 'Dakar',
        },
      },
      generatedCv: null,
      generatedAt: null,
      updatedAt,
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET') as never);
    const body = await res.json();
    expect(body.targetCountry).toBe('France');
    expect(body.answers).toEqual({
      identity: {
        fullName: 'Awa',
        email: 'awa@example.com',
        phone: '+221771234567',
        city: 'Dakar',
      },
    });
    expect(body.updatedAt).toBe(updatedAt.toISOString());
  });
});

describe('PATCH /api/cv', () => {
  it('merges a new step into existing answers without clobbering others', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({
      answers: {
        identity: {
          fullName: 'Awa',
          email: 'awa@example.com',
          phone: '+221771234567',
          city: 'Dakar',
        },
      },
    });
    cvProfileUpsert.mockImplementationOnce(async (args: unknown) => ({
      targetCountry: null,
      targetField: null,
      answers: (args as { update: { answers: unknown } }).update.answers,
      generatedCv: null,
      generatedAt: null,
      updatedAt: new Date('2026-08-09T12:05:00.000Z'),
    }));

    const { PATCH } = await import('./route');
    const res = await PATCH(
      makeReq('PATCH', {
        answers: {
          education: {
            entries: [{ institution: 'UCAD', degree: 'Licence', startYear: 2021, endYear: 2024 }],
          },
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answers.identity.fullName).toBe('Awa');
    expect(body.answers.education.entries).toHaveLength(1);
  });

  it('rejects a malformed step', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: {} });
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { answers: { identity: { fullName: '' } } }) as never);
    expect(res.status).toBe(400);
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { targetCountry: 'France' }) as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { targetCountry: 'France' }) as never);
    expect(res.status).toBe(401);
  });
});
