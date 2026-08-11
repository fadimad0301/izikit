/**
 * Per-user rate limit for POST /api/procedures/[slug]/analyze — 20
 * analyses per user per 24h. Complet itself is marketed as "illimité" (no
 * product-level cap), but every call hits the Anthropic API, so this is a
 * cost guard against click-spam, not a feature limit. Mirrors
 * cv/generation-limiter.ts's shape exactly — same store primitives, same
 * dependency-injected `redis`.
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

export interface CreateAnalyzeLimiterDeps {
  redis?: Redis;
}

export interface AnalyzeLimiter {
  check(userId: string): Promise<NextResponse | null>;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ANALYSES = 20;

export function createAnalyzeLimiter(deps: CreateAnalyzeLimiterDeps): AnalyzeLimiter {
  if (!deps.redis) {
    log.warn('cv-analyze rate limiter using in-memory fallback (Redis absent)');
  }

  const store: RateLimitStore = deps.redis
    ? new RedisRateLimitStore({ redis: deps.redis, prefix: 'rl:cv-analyze:', windowMs: WINDOW_MS })
    : new MemoryRateLimitStore({ windowMs: WINDOW_MS });

  return {
    async check(userId: string) {
      const { totalHits, resetTime } = await store.increment(`user:${userId}`);
      if (totalHits > MAX_ANALYSES) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: 'CV_ANALYSIS_RATE_LIMITED',
            message: `Tu as atteint la limite de 20 analyses aujourd'hui, réessaie demain.`,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(MAX_ANALYSES),
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
