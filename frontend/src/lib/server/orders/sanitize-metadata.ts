import type { Prisma } from '@prisma/client';

// `idempotencyBodyHash` (CR-02, POST /api/orders) is an internal replay
// fingerprint stored on Order.metadata, not a domain field. Strip it at
// every response boundary that returns metadata to a client — admin or
// buyer — rather than trusting each route to remember to do it.
export function sanitizeMetadata(metadata: Prisma.JsonValue): Prisma.JsonValue {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }
  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(
      ([key]) => key !== 'idempotencyBodyHash',
    ),
  ) as Prisma.JsonValue;
}
