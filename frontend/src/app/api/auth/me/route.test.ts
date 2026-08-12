// Tests for GET /api/auth/me (AUTH-06).
// Pattern 14. requireAuth-gated. Note: requireAuth uses cookies() from
// next/headers internally, so tests must use mockNextCookies + prismaMock.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '@/test-utils/prisma-mock';
import { mockNextCookies, __cookieStore } from '@/test-utils/mock-cookies';

mockNextCookies();

vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    verifyToken: vi.fn(),
  };
});

import { verifyToken } from '@/lib/server/auth';
import { GET, PATCH } from './route';
import { NextRequest } from 'next/server';

function makeReq(opts: { tokenCookie?: string; bearer?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest('https://test/api/auth/me', {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  __cookieStore.clear();
  vi.mocked(verifyToken).mockReset();
});

describe('GET /api/auth/me', () => {
  it('Test 1: authed — returns user identity', async () => {
    // Place token cookie via mock store; requireAuth reads it via cookies().
    __cookieStore.clear();
    // Fake cookies.set: use mockStore via the mock-cookies internal store.
    // Simpler: test injects directly through Bearer header path which
    // requireAuth supports as a fallback when no cookie is present.
    vi.mocked(verifyToken).mockResolvedValue({
      sub: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
      name: 'Awa Diop',
      avatarUrl: null,
      phone: '+221771234567',
    } as never);

    const res = await GET(makeReq({ bearer: 'valid-access-token' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: {
        sub: 'u1',
        email: 'a@b.com',
        name: 'Awa Diop',
        avatarUrl: null,
        phone: '+221771234567',
      },
    });
  });

  it('Test 2: no cookie + no bearer — 401 missing token', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Missing token|token/i);
  });

  it('Test 3: stale tokenVersion — 401', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      sub: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 1, // bumped via change-password
    } as never);

    const res = await GET(makeReq({ bearer: 'stale-jwt' }));
    expect(res.status).toBe(401);
  });

  it('Test 4: deleted user — 401', async () => {
    vi.mocked(verifyToken).mockResolvedValue({
      sub: 'u-deleted',
      email: 'gone@b.com',
      tokenVersion: 0,
    });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq({ bearer: 'orphan-jwt' }));
    expect(res.status).toBe(401);
  });
});

function makePatchReq(opts: { body?: unknown; bearer?: string; csrf?: boolean }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.csrf !== false) {
    headers['x-csrf-token'] = 'csrf-token';
    headers.cookie = 'app-csrf=csrf-token';
  }
  return new NextRequest('https://test/api/auth/me', {
    method: 'PATCH',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe('PATCH /api/auth/me', () => {
  beforeEach(() => {
    __cookieStore.clear();
    vi.mocked(verifyToken).mockReset();
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'u1', email: 'a@b.com', tokenVersion: 0 });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      tokenVersion: 0,
    } as never);
  });

  it('Test 1: missing CSRF header — 403', async () => {
    const res = await PATCH(makePatchReq({ body: { name: 'Awa' }, bearer: 'valid', csrf: false }));
    expect(res.status).toBe(403);
  });

  it('Test 2: no auth — 401', async () => {
    const res = await PATCH(makePatchReq({ body: { name: 'Awa' } }));
    expect(res.status).toBe(401);
  });

  it('Test 3: updates name only', async () => {
    prismaMock.user.update.mockResolvedValue({ name: 'Awa Diop', phone: null } as never);
    const res = await PATCH(makePatchReq({ body: { name: 'Awa Diop' }, bearer: 'valid' }));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Awa Diop' },
      select: { id: true, name: true, phone: true },
    });
    expect(await res.json()).toEqual({ name: 'Awa Diop', phone: null });
  });

  it('Test 4: updates phone only', async () => {
    prismaMock.user.update.mockResolvedValue({ name: null, phone: '+221771234567' } as never);
    const res = await PATCH(
      makePatchReq({ body: { phone: '+221 77 123 45 67' }, bearer: 'valid' }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { phone: '+221771234567' },
      select: { id: true, name: true, phone: true },
    });
  });

  it('Test 5: updates name and phone together', async () => {
    prismaMock.user.update.mockResolvedValue({ name: 'Awa', phone: '+221771234567' } as never);
    const res = await PATCH(
      makePatchReq({ body: { name: 'Awa', phone: '+221771234567' }, bearer: 'valid' }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Awa', phone: '+221771234567' },
      select: { id: true, name: true, phone: true },
    });
  });

  it('Test 6: clears phone with an empty string', async () => {
    prismaMock.user.update.mockResolvedValue({ name: null, phone: null } as never);
    const res = await PATCH(makePatchReq({ body: { phone: '' }, bearer: 'valid' }));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { phone: null },
      select: { id: true, name: true, phone: true },
    });
  });

  it('Test 7: empty name — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: { name: '' }, bearer: 'valid' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('Test 8: name over 100 chars — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: { name: 'a'.repeat(101) }, bearer: 'valid' }));
    expect(res.status).toBe(400);
  });

  it('Test 9: malformed phone — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: { phone: 'not-a-phone' }, bearer: 'valid' }));
    expect(res.status).toBe(400);
  });

  it('Test 10: empty body — 400 VALIDATION_FAILED', async () => {
    const res = await PATCH(makePatchReq({ body: {}, bearer: 'valid' }));
    expect(res.status).toBe(400);
  });
});
