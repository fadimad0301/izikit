import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

vi.mock('@/lib/server/redis', () => ({ redis: null }));

const generateCv = vi.fn(async () => ({
  summary: 'Étudiante motivée.',
  sections: [{ title: 'Formation', bullets: ['Licence Informatique — UCAD'] }],
}));
vi.mock('@/lib/server/ai', () => ({
  getAiProvider: vi.fn(() => ({ name: 'claude', generateCv })),
}));

// The limiter is instantiated once at module scope in the route (same
// convention as login/route.ts's module-level `limiter`), so its internal
// MemoryRateLimitStore would otherwise accumulate hits *across* unrelated
// `it()` blocks in this file (dynamic `import('./route')` reuses the same
// module instance unless `vi.resetModules()` runs). Mock it here — the
// limiter's own accumulation behavior is covered in isolation by
// generation-limiter.test.ts (Task 5); this file only needs to assert the
// route reacts correctly to an allow/deny decision.
const limiterCheck = vi.fn(async (..._args: unknown[]): Promise<NextResponse | null> => null);
vi.mock('@/lib/server/cv/generation-limiter', () => ({
  createGenerationLimiter: vi.fn(() => ({ check: (...args: unknown[]) => limiterCheck(...args) })),
}));

const cvProfileFindUnique = vi.fn();
const cvProfileUpdate = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: {
    cvProfile: {
      findUnique: (...args: unknown[]) => cvProfileFindUnique(...args),
      update: (...args: unknown[]) => cvProfileUpdate(...args),
    },
  },
}));

const COMPLETE_ANSWERS = {
  identity: { fullName: 'Awa', email: 'awa@example.com', phone: '+221771234567', city: 'Dakar' },
  education: {
    entries: [{ institution: 'UCAD', degree: 'Licence', startYear: 2021, endYear: 2024 }],
  },
  experience: { entries: [] },
  skills: { skills: ['Excel'], languages: [] },
  objective: { targetCountry: 'France', targetField: 'Informatique' },
};

function makeReq() {
  return new Request(new URL('http://localhost/api/cv/generate'), {
    method: 'POST',
    headers: { 'x-csrf-token': 'test-csrf' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cvProfileUpdate.mockImplementation(async (args: unknown) => ({
    generatedCv: (args as { data: { generatedCv: unknown } }).data.generatedCv,
    generatedAt: new Date('2026-08-09T13:00:00.000Z'),
  }));
});

describe('POST /api/cv/generate', () => {
  it('generates and persists a CV when the profile is complete', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedCv.summary).toBe('Étudiante motivée.');
    expect(generateCv).toHaveBeenCalledWith({ answers: COMPLETE_ANSWERS });
    expect(cvProfileUpdate).toHaveBeenCalled();
  });

  it('returns 400 INCOMPLETE_PROFILE when a step is missing', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({
      answers: { ...COMPLETE_ANSWERS, skills: undefined },
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INCOMPLETE_PROFILE');
  });

  it('returns 503 AI_NOT_CONFIGURED when no provider is available', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    const { getAiProvider } = await import('@/lib/server/ai');
    (getAiProvider as unknown as Mock).mockReturnValueOnce(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('returns 502 AI_GENERATION_FAILED when the provider throws', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    generateCv.mockImplementationOnce(async () => {
      throw new Error('Claude timeout');
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AI_GENERATION_FAILED');
  });

  it('returns the limiter response verbatim when the rate limit is exceeded', async () => {
    cvProfileFindUnique.mockResolvedValueOnce({ answers: COMPLETE_ANSWERS });
    limiterCheck.mockResolvedValueOnce(
      NextResponse.json({ error: 'CV_GENERATION_RATE_LIMITED' }, { status: 429 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('CV_GENERATION_RATE_LIMITED');
    expect(generateCv).not.toHaveBeenCalled();
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
  });
});
