import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

const analyzeCvMock = vi.fn(async () => ({ points: ['Ajoute des chiffres à tes réalisations.'] }));
vi.mock('@/lib/server/ai', () => ({
  getAiProvider: vi.fn(() => ({ name: 'claude', generateCv: vi.fn(), analyzeCv: analyzeCvMock })),
}));

vi.mock('@/lib/server/redis', () => ({ redis: null }));

const GENERATED_CV = {
  summary: 'Étudiant motivé.',
  sections: [{ title: 'Éducation', bullets: ['Licence'] }],
};

function makePost(): NextRequest {
  return new NextRequest('http://localhost/api/procedures/campus-france/analyze', {
    method: 'POST',
  });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  analyzeCvMock.mockClear();
});

describe('POST /api/procedures/[slug]/analyze', () => {
  it('404s for an unknown slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('unknown'));
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not Complet tier', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      id: 'proc_1',
      name: 'Campus France',
      country: 'France',
      field: null,
    } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('COMPLET_REQUIRED');
  });

  it('400s CV_NOT_GENERATED when the profile has no generatedCv', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      id: 'proc_1',
      name: 'Campus France',
      country: 'France',
      field: null,
    } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: null } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('CV_NOT_GENERATED');
    expect(analyzeCvMock).not.toHaveBeenCalled();
  });

  it('returns points on success and passes procedure context to analyzeCv', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      id: 'proc_1',
      name: 'Campus France',
      country: 'France',
      field: null,
    } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: GENERATED_CV } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toEqual(['Ajoute des chiffres à tes réalisations.']);
    expect(analyzeCvMock).toHaveBeenCalledWith({
      generatedCv: GENERATED_CV,
      procedure: { name: 'Campus France', country: 'France', field: undefined },
    });
  });

  it('502s AI_ANALYSIS_FAILED when the provider throws', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      id: 'proc_1',
      name: 'Campus France',
      country: 'France',
      field: null,
    } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: GENERATED_CV } as never);
    analyzeCvMock.mockRejectedValueOnce(new Error('Anthropic down'));
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AI_ANALYSIS_FAILED');
  });

  it('503s AI_NOT_CONFIGURED when no provider is available', async () => {
    const { getAiProvider } = await import('@/lib/server/ai');
    (getAiProvider as unknown as Mock).mockReturnValueOnce(null);
    prismaMock.procedure.findUnique.mockResolvedValue({
      id: 'proc_1',
      name: 'Campus France',
      country: 'France',
      field: null,
    } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.cvProfile.findUnique.mockResolvedValue({ generatedCv: GENERATED_CV } as never);
    const { POST } = await import('./route');
    const res = await POST(makePost(), ctxFor('campus-france'));
    expect(res.status).toBe(503);
  });
});
