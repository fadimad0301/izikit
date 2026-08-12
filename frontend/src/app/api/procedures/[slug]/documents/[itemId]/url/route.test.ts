import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  getSignedDeliveryUrl: vi.fn(
    (publicId: string, resourceType: string, expiresAt: number) =>
      `https://api.cloudinary.com/v1_1/test/${resourceType}/download?public_id=${publicId}&expires_at=${expiresAt}`,
  ),
}));

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

function makeGet(): NextRequest {
  return new NextRequest(
    'http://localhost/api/procedures/campus-france/documents/passeport-valide/url',
  );
}

function ctxFor(slug: string, itemId: string) {
  return { params: Promise.resolve({ slug, itemId }) };
}

describe('GET /api/procedures/[slug]/documents/[itemId]/url', () => {
  it('404s for an unknown procedure slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeGet(), ctxFor('unknown', 'passeport-valide'));
    expect(res.status).toBe(404);
  });

  it('404s (not 403) when the caller is not Complet tier', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1' } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const { GET } = await import('./route');
    const res = await GET(makeGet(), ctxFor('campus-france', 'passeport-valide'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('DOCUMENT_NOT_FOUND');
  });

  it('404s when no document exists for this checklist item', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1' } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.findUnique.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeGet(), ctxFor('campus-france', 'passeport-valide'));
    expect(res.status).toBe(404);
  });

  it('returns a signed url with a future expiresAt when the document exists', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({ id: 'proc_1' } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.findUnique.mockResolvedValue({
      cloudinaryPublicId: 'procedures/user-1/proc_1/passeport-valide',
      resourceType: 'image',
    } as never);
    const { GET } = await import('./route');
    const before = Date.now();
    const res = await GET(makeGet(), ctxFor('campus-france', 'passeport-valide'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('procedures/user-1/proc_1/passeport-valide');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(before);
  });
});
