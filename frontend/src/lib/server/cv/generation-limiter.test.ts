import { describe, it, expect, beforeEach } from 'vitest';
import { createGenerationLimiter } from './generation-limiter';

describe('createGenerationLimiter (in-memory, redis absent)', () => {
  let limiter: ReturnType<typeof createGenerationLimiter>;

  beforeEach(() => {
    limiter = createGenerationLimiter({});
  });

  it('allows the first 5 requests for a user', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await limiter.check('user-1');
      expect(res).toBeNull();
    }
  });

  it('rejects the 6th request with 429', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    const body = await res?.json();
    expect(body.error).toBe('CV_GENERATION_RATE_LIMITED');
  });

  it('tracks separate buckets per user', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-2');
    expect(res).toBeNull();
  });
});
