import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/orders/order_1', { method: 'GET' });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/orders/[id]', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when the order belongs to a different user', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'someone-else',
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: null,
    } as never);
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(404);
  });

  it('returns status/amount/currency/metadata for the owner', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user-1',
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1', procedureSlug: 'campus-france' },
    } as never);
    const res = await GET(makeGet(), ctxFor('order_1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1', procedureSlug: 'campus-france' },
    });
  });

  it('strips idempotencyBodyHash from metadata (internal replay fingerprint, not buyer-facing)', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user-1',
      status: 'PAID',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1', idempotencyBodyHash: 'deadbeef' },
    } as never);
    const res = await GET(makeGet(), ctxFor('order_1'));
    const body = await res.json();
    expect(body.metadata).toEqual({ tier: 'SIMPLE', procedureId: 'proc_1' });
  });
});
