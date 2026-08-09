import 'server-only';
import { createClaudeProvider } from './claude';
import type { AiProvider } from './provider';

// Lazy singleton — mirrors redis.ts's `Redis | null` pattern. Env is read
// inside the function (not at module top) so vi.stubEnv works in tests and
// the app never crashes at import time when the key is absent.
let _provider: AiProvider | null | undefined;

export function getAiProvider(): AiProvider | null {
  if (_provider !== undefined) return _provider;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    _provider = null;
    return null;
  }

  const model = process.env.ANTHROPIC_MODEL;
  _provider = createClaudeProvider(model ? { apiKey, model } : { apiKey });
  return _provider;
}

/**
 * Test-only escape hatch — clears the cached provider so a test can mutate
 * `process.env.ANTHROPIC_*` and re-trigger lazy init. Never call from
 * application code.
 * @internal
 */
export function __resetAiProviderSingleton(): void {
  _provider = undefined;
}

export type { AiProvider, CvGenerationInput } from './provider';
