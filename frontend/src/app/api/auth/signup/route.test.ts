// AUTH-01 — POST /api/auth/signup tests.
// Pattern: D-25 mock Prisma + module-level vi.mock (Pitfall 11).
// prismaMock import MUST come first so the vi.mock auto-hoists above route imports.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';

mockNextCookies();

vi.mock('@/lib/server/auth/hibp', () => ({
  isPwned: vi.fn().mockResolvedValue(false),
}));

// Real bcrypt is slow enough (by design) to make the happy-path test flaky
// under full-suite parallel load — mock just the hash, same reasoning
// login/route.test.ts uses for mocking verifyPassword. createAccessToken /
// createRefreshToken / setAuthCookies / setCsrfCookie stay real.
vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue('$2a$12$mockmockmockmockmockmockmockmockmockmockmoc'),
  };
});

import { POST } from './route';
import { isPwned } from '@/lib/server/auth/hibp';

function makeReq(body: unknown): NextRequest {
  // Build init inline so optional fields (body) aren't typed as `T | undefined`,
  // which trips Next.js's RequestInit under exactOptionalPropertyTypes.
  return body === undefined
    ? new NextRequest('http://test/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    : new NextRequest('http://test/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
}

beforeEach(() => {
  __cookieStore.clear();
  vi.clearAllMocks();
});

describe('POST /api/auth/signup', () => {
  it('creates a new user and logs them in — issues 3 cookies (no email-verification step)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'u-new',
      email: 'new@example.com',
      tokenVersion: 0,
    } as never);

    const res = await POST(makeReq({ email: 'new@example.com', password: 'a-strong-passphrase' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, user: { sub: 'u-new', email: 'new@example.com' } });

    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    const createArg = prismaMock.user.create.mock.calls[0]?.[0];
    expect(createArg?.data?.emailVerifiedAt).toBeInstanceOf(Date);

    expect(__cookieStore.has('app-token')).toBe(true);
    expect(__cookieStore.has('app-refresh')).toBe(true);
    expect(__cookieStore.has('app-csrf')).toBe(true);
  });

  it('returns 409 EMAIL_ALREADY_EXISTS for an existing email — no cookies issued', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u-existing' } as never);

    const res = await POST(
      makeReq({ email: 'existing@example.com', password: 'a-strong-passphrase' }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('EMAIL_ALREADY_EXISTS');

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(__cookieStore.has('app-token')).toBe(false);
    expect(__cookieStore.has('app-refresh')).toBe(false);
    expect(__cookieStore.has('app-csrf')).toBe(false);
  });

  it('rejects banned passwords with PASSWORD_BANNED before user lookup', async () => {
    const res = await POST(makeReq({ email: 'foo@example.com', password: 'password' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PASSWORD_BANNED');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects too-short passwords with PASSWORD_TOO_SHORT', async () => {
    const res = await POST(makeReq({ email: 'foo@example.com', password: 'short' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PASSWORD_TOO_SHORT');
    expect(body.message).toContain('10');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_FAILED for malformed email', async () => {
    const res = await POST(makeReq({ email: 'not-an-email', password: 'a-strong-passphrase' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 429 TOO_MANY_SIGNUP_ATTEMPTS when the per-email limit is hit', async () => {
    // Rate limiting runs before the new-vs-existing branch, so an existing
    // email keeps every call on the fast 409 path (no bcrypt/JWT work) —
    // avoids 5x real crypto in parallel timing out the test.
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u-rate' } as never);

    const calls = await Promise.all(
      Array.from({ length: 6 }, () =>
        POST(
          makeReq({
            email: 'rate-target@example.com',
            password: 'a-strong-passphrase',
          }),
        ),
      ),
    );
    const statuses = calls.map((r) => r.status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    const limited = calls.find((r) => r.status === 429)!;
    const body = await limited.json();
    expect(body.error).toBe('TOO_MANY_SIGNUP_ATTEMPTS');
  });

  it('rejects pwned passwords with PASSWORD_PWNED when PASSWORD_HIBP_CHECK=1', async () => {
    vi.stubEnv('PASSWORD_HIBP_CHECK', '1');
    (isPwned as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    try {
      const res = await POST(
        makeReq({
          email: 'hibp@example.com',
          password: 'a-very-unique-passphrase-1234',
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('PASSWORD_PWNED');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("source exports runtime = 'nodejs' (Phase 0 guard)", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
  });
});
