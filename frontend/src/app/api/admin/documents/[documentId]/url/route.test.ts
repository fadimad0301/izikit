import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));
vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  getSignedDeliveryUrl: vi.fn(() => 'https://res.cloudinary.com/signed/test-url'),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { GET } from './route';
import { seedAdmin } from '@/test-utils/admin-fixtures';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'admin@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('/api/admin/documents/[documentId]/url', () => {
  it('GET returns a signed URL for a valid document id and logs the view', async () => {
    prismaMock.procedureDocument.findUnique.mockResolvedValueOnce({
      id: 'doc_1',
      userId: 'user_1',
      cloudinaryPublicId: 'procedures/user_1/proc_1/passport',
      resourceType: 'image',
    } as never);

    const res = await GET(makeGet('http://test/api/admin/documents/doc_1/url'), {
      params: Promise.resolve({ documentId: 'doc_1' }),
    });

    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toBe('https://res.cloudinary.com/signed/test-url');
    expect(typeof body.expiresAt).toBe('string');

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin_1',
        action: 'document.view',
        targetType: 'ProcedureDocument',
        targetId: 'doc_1',
        metadata: { ownerUserId: 'user_1' },
      }),
    );
  });

  it('GET returns 404 DOCUMENT_NOT_FOUND for an unknown id', async () => {
    prismaMock.procedureDocument.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeGet('http://test/api/admin/documents/missing/url'), {
      params: Promise.resolve({ documentId: 'missing' }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DOCUMENT_NOT_FOUND');
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('GET propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/documents/doc_1/url'), {
      params: Promise.resolve({ documentId: 'doc_1' }),
    });
    expect(res.status).toBe(403);
    expect(prismaMock.procedureDocument.findUnique).not.toHaveBeenCalled();
  });

  it('rate limits admin per-userId — propagates 429', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/documents/doc_1/url'), {
      params: Promise.resolve({ documentId: 'doc_1' }),
    });
    expect(res.status).toBe(429);
    expect(prismaMock.procedureDocument.findUnique).not.toHaveBeenCalled();
  });
});
