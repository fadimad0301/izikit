import { describe, it, expect, beforeEach } from 'vitest';
import { createAnalyzeLimiter } from './analyze-limiter';

describe('createAnalyzeLimiter (in-memory, redis absent)', () => {
  let limiter: ReturnType<typeof createAnalyzeLimiter>;

  beforeEach(() => {
    limiter = createAnalyzeLimiter({});
  });

  it('allows the first 20 requests for a user', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await limiter.check('user-1');
      expect(res).toBeNull();
    }
  });

  it('rejects the 21st request with 429', async () => {
    for (let i = 0; i < 20; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    const body = await res?.json();
    expect(body.error).toBe('CV_ANALYSIS_RATE_LIMITED');
  });

  it('tracks separate buckets per user', async () => {
    for (let i = 0; i < 20; i++) {
      await limiter.check('user-1');
    }
    const res = await limiter.check('user-2');
    expect(res).toBeNull();
  });
});
