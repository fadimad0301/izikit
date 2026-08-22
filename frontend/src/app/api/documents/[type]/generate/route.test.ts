// Mock strategy mirrors src/app/api/cv/generate/route.test.ts, adapted for
// the dynamic [type] segment and the (userId, type)-keyed limiter.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

vi.mock('@/lib/server/redis', () => ({ redis: null }));

const generateDocument = vi.fn(async () => ({
  title: 'Lettre de motivation',
  paragraphs: ['Madame, Monsieur, …'],
}));
vi.mock('@/lib/server/ai', () => ({
  getAiProvider: vi.fn(() => ({ name: 'claude', generateDocument })),
}));

// Same rationale as cv/generate/route.test.ts: the limiter is module-scoped
// in the route, so it's mocked here rather than exercised for real — its
// own accumulation behavior is covered by generation-limiter.test.ts.
const limiterCheck = vi.fn(async (..._args: unknown[]): Promise<NextResponse | null> => null);
vi.mock('@/lib/server/documents/generation-limiter', () => ({
  createDocumentGenerationLimiter: vi.fn(() => ({
    check: (...args: unknown[]) => limiterCheck(...args),
  })),
}));

const COMPLETE_COVER_LETTER_ANSWERS = {
  targetProgram: 'Master 2 Data Science',
  targetCountry: 'France',
  motivation: 'Je souhaite approfondir mes compétences en data science.',
  relevantExperience: 'Stage de 6 mois en analyse de données.',
};

function makeReq(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/documents/cover-letter/generate'), {
    method: 'POST',
    headers: { 'x-csrf-token': 'test-csrf' },
  });
}

function ctxFor(type: string) {
  return { params: Promise.resolve({ type }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.generatedDocument.update.mockImplementation((async (args: unknown) => ({
    content: (args as { data: { content: unknown } }).data.content,
    generatedAt: new Date('2026-08-22T13:00:00.000Z'),
  })) as never);
});

describe('POST /api/documents/[type]/generate', () => {
  it('404s DOCUMENT_TYPE_NOT_FOUND for an unknown slug', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('not-a-real-type'));
    expect(res.status).toBe(404);
  });

  it('generates and persists content when answers are complete', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: COMPLETE_COVER_LETTER_ANSWERS,
    } as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content.title).toBe('Lettre de motivation');
    expect(generateDocument).toHaveBeenCalledWith({
      type: 'COVER_LETTER',
      answers: COMPLETE_COVER_LETTER_ANSWERS,
    });
  });

  it('returns 400 INCOMPLETE_ANSWERS when a required field is missing', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: { ...COMPLETE_COVER_LETTER_ANSWERS, motivation: undefined },
    } as never);
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INCOMPLETE_ANSWERS');
  });

  it('returns 400 INCOMPLETE_ANSWERS when no draft exists at all', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(400);
  });

  it('returns 503 AI_NOT_CONFIGURED when no provider is available', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: COMPLETE_COVER_LETTER_ANSWERS,
    } as never);
    const { getAiProvider } = await import('@/lib/server/ai');
    (getAiProvider as unknown as Mock).mockReturnValueOnce(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(503);
  });

  it('does not consume rate-limit quota when AI is not configured', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: COMPLETE_COVER_LETTER_ANSWERS,
    } as never);
    const { getAiProvider } = await import('@/lib/server/ai');
    (getAiProvider as unknown as Mock).mockReturnValueOnce(null);
    const { POST } = await import('./route');
    await POST(makeReq(), ctxFor('cover-letter'));
    expect(limiterCheck).not.toHaveBeenCalled();
  });

  it('returns 502 AI_GENERATION_FAILED when the provider throws', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: COMPLETE_COVER_LETTER_ANSWERS,
    } as never);
    generateDocument.mockImplementationOnce(async () => {
      throw new Error('Claude timeout');
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AI_GENERATION_FAILED');
  });

  it('returns the limiter response verbatim when the rate limit is exceeded', async () => {
    prismaMock.generatedDocument.findUnique.mockResolvedValue({
      answers: COMPLETE_COVER_LETTER_ANSWERS,
    } as never);
    limiterCheck.mockResolvedValueOnce(
      NextResponse.json({ error: 'DOCUMENT_GENERATION_RATE_LIMITED' }, { status: 429 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(429);
    expect(generateDocument).not.toHaveBeenCalled();
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(
      new Response(null, { status: 403 }) as never,
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctxFor('cover-letter'));
    expect(res.status).toBe(401);
  });
});
