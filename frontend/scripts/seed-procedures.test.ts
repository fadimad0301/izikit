// Companion unit test for scripts/seed-procedures.ts — mirrors
// scripts/seed-dev.test.ts's mocked-PrismaClient pattern (no real DB
// connection, no subprocess spawn).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { main } from './seed-procedures';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe('scripts/seed-procedures', () => {
  it('upserts every procedure in the catalog, keyed by slug', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    expect(prismaMock.procedure.upsert).toHaveBeenCalledTimes(5);
    const firstCall = prismaMock.procedure.upsert.mock.calls[0]?.[0];
    expect(firstCall?.where).toEqual({ slug: 'campus-france' });
  });

  it('stores a non-empty checklist array for every procedure', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    for (const call of prismaMock.procedure.upsert.mock.calls) {
      const createData = call[0]?.create as { checklist: unknown[] };
      expect(Array.isArray(createData.checklist)).toBe(true);
      expect(createData.checklist.length).toBeGreaterThan(0);
    }
  });

  it('gives every checklist item a non-empty, unique-within-procedure id', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });

    for (const call of prismaMock.procedure.upsert.mock.calls) {
      const createData = call[0]?.create as { checklist: { id: string }[] };
      const ids = createData.checklist.map((item) => item.id);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is idempotent — running twice performs the same 5 upserts both times', async () => {
    prismaMock.procedure.upsert.mockResolvedValue({
      slug: 'campus-france',
      name: 'Campus France',
    } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([], { prisma: prismaMock });
    await main([], { prisma: prismaMock });

    expect(prismaMock.procedure.upsert).toHaveBeenCalledTimes(10);
  });
});
