/**
 * Per-user, per-document-type rate limit for POST /api/documents/[type]/generate
 * — 5 generations/regenerations per user per type per 24h. Mirrors
 * `cv/generation-limiter.ts` exactly (same store primitives, same cadence);
 * kept as a separate file rather than a generalized shared limiter because
 * the two already diverge in error code/message and are cheap to keep in
 * sync by inspection, matching this codebase's existing cv/analyze-limiter.ts
 * vs cv/generation-limiter.ts split.
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
import type { DocumentType } from '@/lib/validation/document-types';

export interface CreateDocumentGenerationLimiterDeps {
  redis?: Redis;
}

export interface DocumentGenerationLimiter {
  check(userId: string, type: DocumentType): Promise<NextResponse | null>;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_GENERATIONS = 5;

export function createDocumentGenerationLimiter(
  deps: CreateDocumentGenerationLimiterDeps,
): DocumentGenerationLimiter {
  if (!deps.redis) {
    log.warn('document-generate rate limiter using in-memory fallback (Redis absent)');
  }

  const store: RateLimitStore = deps.redis
    ? new RedisRateLimitStore({
        redis: deps.redis,
        prefix: 'rl:doc-generate:',
        windowMs: WINDOW_MS,
      })
    : new MemoryRateLimitStore({ windowMs: WINDOW_MS });

  return {
    async check(userId: string, type: DocumentType) {
      const { totalHits, resetTime } = await store.increment(`user:${userId}:${type}`);
      if (totalHits > MAX_GENERATIONS) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: 'DOCUMENT_GENERATION_RATE_LIMITED',
            message: `Tu as atteint la limite de 5 générations aujourd'hui pour ce document, réessaie demain.`,
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
