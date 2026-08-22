// Mock strategy mirrors src/app/api/cv/route.test.ts, adapted for the
// dynamic [type] segment (ctxFor helper mirrors
// src/app/api/procedures/[slug]/analyze/route.test.ts).
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/documents/cover-letter'), {
    method,
    headers: { 'x-csrf-token': 'test-csrf', 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function ctxFor(type: string) {
  return { params: Promise.resolve({ type }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/documents/[type]', () => {
  it('404s DOCUMENT_TYPE_NOT_FOUND for an unknown slug', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET'), ctxFor('not-a-real-type'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('DOCUMENT_TYPE_NOT_FOUND');
  });

  it('returns empty answers/content when no draft exists', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET'), ctxFor('cover-letter'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ answers: {}, content: null, generatedAt: null, updatedAt: null });
  });

  it('returns the stored draft', async () => {
    const updatedAt = new Date('2026-08-22T12:00:00.000Z');
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: { targetProgram: 'Master IA', targetCountry: 'France' },
      content: null,
      generatedAt: null,
      updatedAt,
    } as never);
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET'), ctxFor('cover-letter'));
    const body = await res.json();
    expect(body.answers).toEqual({ targetProgram: 'Master IA', targetCountry: 'France' });
    expect(body.updatedAt).toBe(updatedAt.toISOString());
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { GET } = await import('./route');
    const res = await GET(makeReq('GET'), ctxFor('cover-letter'));
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/documents/[type]', () => {
  it('404s DOCUMENT_TYPE_NOT_FOUND for an unknown slug', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { answers: {} }), ctxFor('not-a-real-type'));
    expect(res.status).toBe(404);
  });

  it('saves a partial draft (not every required field filled in yet)', async () => {
    prismaMock.generatedDocument.upsert.mockImplementation((async (args: unknown) => ({
      answers: (args as { create: { answers: unknown } }).create.answers,
      content: null,
      generatedAt: null,
      updatedAt: new Date('2026-08-22T12:05:00.000Z'),
    })) as never);

    const { PATCH } = await import('./route');
    const res = await PATCH(
      makeReq('PATCH', { answers: { targetProgram: 'Master IA' } }),
      ctxFor('cover-letter'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answers).toEqual({ targetProgram: 'Master IA' });
  });

  it('replaces the whole answers blob (full replace, not merge)', async () => {
    prismaMock.generatedDocument.upsert.mockImplementation((async (args: unknown) => ({
      answers: (args as { update: { answers: unknown } }).update.answers,
      content: null,
      generatedAt: null,
      updatedAt: new Date('2026-08-22T12:06:00.000Z'),
    })) as never);

    const { PATCH } = await import('./route');
    const res = await PATCH(
      makeReq('PATCH', { answers: { targetCountry: 'Canada' } }),
      ctxFor('cover-letter'),
    );
    const body = await res.json();
    // Only the field sent in this PATCH is present — no server-side merge
    // with a prior draft, matching the route's documented full-replace semantic.
    expect(body.answers).toEqual({ targetCountry: 'Canada' });
  });

  it('rejects an unknown field with a 400', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(
      makeReq('PATCH', { answers: { motivation: 123 } }),
      ctxFor('cover-letter'),
    );
    expect(res.status).toBe(400);
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(
      new Response(null, { status: 403 }) as never,
    );
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { answers: {} }), ctxFor('cover-letter'));
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { PATCH } = await import('./route');
    const res = await PATCH(makeReq('PATCH', { answers: {} }), ctxFor('cover-letter'));
    expect(res.status).toBe(401);
  });
});
