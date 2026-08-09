import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('./claude', () => ({
  createClaudeProvider: vi.fn((options: { apiKey: string; model?: string }) => ({
    name: 'claude',
    apiKey: options.apiKey,
    model: options.model,
    generateCv: vi.fn(),
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getAiProvider', () => {
  it('returns null when ANTHROPIC_API_KEY is absent', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { getAiProvider } = await import('./index');
    expect(getAiProvider()).toBeNull();
  });

  it('returns a provider when ANTHROPIC_API_KEY is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { getAiProvider } = await import('./index');
    const provider = getAiProvider();
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe('claude');
  });

  it('caches the provider across calls', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { getAiProvider } = await import('./index');
    expect(getAiProvider()).toBe(getAiProvider());
  });
});
