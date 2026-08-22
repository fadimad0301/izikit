import { describe, it, expect, beforeEach } from 'vitest';
import { createDocumentGenerationLimiter } from './generation-limiter';

describe('createDocumentGenerationLimiter (in-memory, redis absent)', () => {
  let limiter: ReturnType<typeof createDocumentGenerationLimiter>;

  beforeEach(() => {
    limiter = createDocumentGenerationLimiter({});
  });

  it('allows the first 5 requests for a user+type', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await limiter.check('user-1', 'COVER_LETTER');
      expect(res).toBeNull();
    }
  });

  it('rejects the 6th request with 429', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1', 'COVER_LETTER');
    }
    const res = await limiter.check('user-1', 'COVER_LETTER');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    const body = await res?.json();
    expect(body.error).toBe('DOCUMENT_GENERATION_RATE_LIMITED');
  });

  it('tracks separate buckets per user', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1', 'COVER_LETTER');
    }
    const res = await limiter.check('user-2', 'COVER_LETTER');
    expect(res).toBeNull();
  });

  it('tracks separate buckets per document type for the same user', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1', 'COVER_LETTER');
    }
    const res = await limiter.check('user-1', 'RECOMMENDATION_LETTER');
    expect(res).toBeNull();
  });
});
