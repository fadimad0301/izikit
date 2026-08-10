import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bictorysFixtureRequest } from '@/test-utils/bictorys-mock';

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const outboxCreate = vi.fn();
const procedureAccessUpsert = vi.fn();
const procedureFindUnique = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: { findUnique, create, update },
    order: { findFirst: orderFindFirst, update: orderUpdate },
    outboxEvent: { create: outboxCreate },
    procedureAccess: { upsert: procedureAccessUpsert },
    procedure: { findUnique: procedureFindUnique },
  }),
);

vi.mock('@/lib/server/prisma', () => ({
  prisma: { $transaction },
}));

beforeEach(() => {
  vi.stubEnv('BICTORYS_API_URL', 'https://api.bictorys.test');
  vi.stubEnv('BICTORYS_API_KEY', 'test-api-key');
  vi.stubEnv('BICTORYS_WEBHOOK_SECRET', 'test-webhook-secret');
  vi.stubEnv('BICTORYS_WEBHOOK_REPLAY_WINDOW_MS', '60000');
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  orderFindFirst.mockReset();
  orderUpdate.mockReset();
  outboxCreate.mockReset();
  procedureAccessUpsert.mockReset();
  procedureFindUnique.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/webhooks/bictorys', () => {
  it('valid HMAC + first delivery returns 200 deduped:false (WH-01)', async () => {
    findUnique.mockResolvedValueOnce(null); // no existing WebhookLog row
    orderFindFirst.mockResolvedValueOnce(null); // unknown charge — onPaid drops
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduped: false });
    expect(create).toHaveBeenCalled(); // WebhookLog row inserted
  });

  it('replay of same (externalId, eventType) returns deduped:true (WH-02)', async () => {
    findUnique.mockResolvedValueOnce({ id: 'wl1', processedAt: new Date() });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduped: true });
    expect(create).not.toHaveBeenCalled(); // no new row written
  });

  it('tampered body returns 401', async () => {
    const { rawBody, headers } = (await import('@/test-utils/bictorys-mock')).bictorysFixture({
      status: 'succeeded',
    });
    const tampered = Buffer.from(rawBody.toString('utf8').replace('succeeded', 'failed'));
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost/api/webhooks/bictorys', {
      method: 'POST',
      headers,
      body: tampered,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('expired replay window (drift > 60s) returns 401', async () => {
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({
      status: 'succeeded',
      timestamp: Date.now() - 70_000, // 70s old
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('onPaid enqueues outbox event when order is found (WH-02 — outbox-not-closures)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o1',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 1000,
      currency: 'XOF',
    });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(outboxCreate).toHaveBeenCalled();
    // Assert at least one outbox row's kind starts with 'notification.' or 'email.'
    const kinds = outboxCreate.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    );
    expect(
      kinds.some(
        (k) => k === 'notification.payment_received' || k === 'email.payment_confirmation',
      ),
    ).toBe(true);
  });

  it('exports runtime=nodejs and dynamic=force-dynamic (WH-01)', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('onPaid creates ProcedureAccess for a SIMPLE-tier order with procedureId (Phase 4)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o1',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1', priceFcfa: 5000 });
    procedureAccessUpsert.mockResolvedValue({ id: 'pa1' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).toHaveBeenCalledWith({
      where: { userId_procedureId: { userId: 'u1', procedureId: 'proc_1' } },
      create: { userId: 'u1', procedureId: 'proc_1', orderId: 'o1' },
      update: {},
    });
  });

  it('onPaid does not create ProcedureAccess when metadata has no tier/procedureId (Phase 4)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o2',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: null,
    });
    outboxCreate.mockResolvedValue({ id: 'ob2' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).not.toHaveBeenCalled();
  });

  it('onPaid does not grant access and does not throw when procedureId is unknown (final review)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o3',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_missing' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob3' });
    procedureFindUnique.mockResolvedValueOnce(null);
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(procedureAccessUpsert).not.toHaveBeenCalled();
  });

  it('onPaid does not grant access when the paid amount is below the procedure price (final review)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o4',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 1,
      currency: 'XOF',
      metadata: { tier: 'SIMPLE', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob4' });
    procedureFindUnique.mockResolvedValueOnce({ id: 'proc_1', priceFcfa: 5000 });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(procedureAccessUpsert).not.toHaveBeenCalled();
  });

  it('onPaid does not create ProcedureAccess when tier is not SIMPLE (final review)', async () => {
    findUnique.mockResolvedValueOnce(null);
    orderFindFirst.mockResolvedValueOnce({
      id: 'o5',
      userId: 'u1',
      customerEmail: 'a@b.com',
      amount: 5000,
      currency: 'XOF',
      metadata: { tier: 'OTHER', procedureId: 'proc_1' },
    });
    outboxCreate.mockResolvedValue({ id: 'ob5' });
    const { POST } = await import('./route');
    const { req } = bictorysFixtureRequest({ status: 'succeeded' });
    await POST(req);
    expect(procedureAccessUpsert).not.toHaveBeenCalled();
    expect(procedureFindUnique).not.toHaveBeenCalled();
  });
});
