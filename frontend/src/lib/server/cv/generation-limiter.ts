/**
 * Per-user rate limit for POST /api/cv/generate — 5 generations/regenerations
 * per user per 24h. Same store primitives as rate-limit-by-email.ts, keyed by
 * userId instead of email (generation always happens post-auth, so there's
 * always a userId — no IP fallback needed).
 *
 * Backed by Upstash Redis when available, in-memory otherwise. The
 * dependency-injected `redis` (rather than importing the singleton directly)
 * mirrors rate-limit-by-email.ts's `CreateEmailLimiterDeps` so tests can
 * exercise both branches without touching real env/network.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { Redis } from '@upstash/redis';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../rate-limit-store';
import { log } from '../observability/log';

export interface CreateGenerationLimiterDeps {
  redis?: Redis;
}

export interface GenerationLimiter {
  check(userId: string): Promise<NextResponse | null>;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_GENERATIONS = 5;

export function createGenerationLimiter(deps: CreateGenerationLimiterDeps): GenerationLimiter {
  if (!deps.redis) {
    log.warn('cv-generate rate limiter using in-memory fallback (Redis absent)');
  }

  const store: RateLimitStore = deps.redis
    ? new RedisRateLimitStore({ redis: deps.redis, prefix: 'rl:cv-generate:', windowMs: WINDOW_MS })
    : new MemoryRateLimitStore({ windowMs: WINDOW_MS });

  return {
    async check(userId: string) {
      const { totalHits, resetTime } = await store.increment(`user:${userId}`);
      if (totalHits > MAX_GENERATIONS) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: 'CV_GENERATION_RATE_LIMITED',
            message: `Tu as atteint la limite de 5 générations aujourd'hui, réessaie demain.`,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(MAX_GENERATIONS),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(resetTime.getTime() / 1000)),
            },
          },
        );
      }
      return null;
    },
  };
}
