import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mockCloudinaryClient } from '@/test-utils/cloudinary-mock';

const cl = mockCloudinaryClient();

vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  uploadAuthenticatedBuffer: vi.fn((id: string, body: Buffer) =>
    cl.uploadAuthenticatedBuffer(id, body),
  ),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {
    constructor() {
      super('Storage not configured');
      this.name = 'StorageNotConfiguredError';
    }
  },
}));

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

beforeEach(() => {
  vi.stubEnv('PROCEDURE_DOC_ALLOWED_MIME', 'image/jpeg,image/png,image/webp,application/pdf');
  vi.stubEnv('UPLOAD_MAX_BYTES', '10485760');
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const PROCEDURE_ROW = {
  id: 'proc_1',
  checklist: [{ id: 'passeport-valide', title: 'Passeport en cours de validité' }],
};

function makeReq(fields: { checklistItemId?: string; file?: File | null } = {}): Request {
  const fd = new FormData();
  if (fields.checklistItemId !== undefined) fd.append('checklistItemId', fields.checklistItemId);
  if (fields.file) fd.append('file', fields.file);
  return new Request(new URL('http://localhost/api/procedures/campus-france/documents'), {
    method: 'POST',
    body: fd,
    headers: { 'x-csrf-token': 'test-csrf' },
  });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const jpeg = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'passeport.jpg', { type: 'image/jpeg' });

describe('POST /api/procedures/[slug]/documents', () => {
  it('404s for an unknown slug', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('unknown'),
    );
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not Complet tier', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'SIMPLE' } as never);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('COMPLET_REQUIRED');
  });

  it('403s when the caller has no access at all', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(403);
  });

  it('400s for a checklistItemId that does not exist on this procedure', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'unknown-item', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNKNOWN_CHECKLIST_ITEM');
  });

  it('uploads with type authenticated and upserts ProcedureDocument on success', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.upsert.mockResolvedValue({
      checklistItemId: 'passeport-valide',
      filename: 'passeport.jpg',
    } as never);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      checklistItemId: 'passeport-valide',
      filename: 'passeport.jpg',
      uploaded: true,
    });
    expect(prismaMock.procedureDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_procedureId_checklistItemId: {
            userId: 'user-1',
            procedureId: 'proc_1',
            checklistItemId: 'passeport-valide',
          },
        },
      }),
    );
  });

  it('uploads a valid PDF successfully (201)', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    prismaMock.procedureDocument.upsert.mockResolvedValue({
      checklistItemId: 'passeport-valide',
      filename: 'releve.pdf',
    } as never);
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'releve.pdf', {
      type: 'application/pdf',
    });
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: pdf }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      checklistItemId: 'passeport-valide',
      filename: 'releve.pdf',
      uploaded: true,
    });
  });

  it('returns 500 without attempting an upload when the checklist fails schema validation', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue({
      id: 'proc_1',
      checklist: [{ title: 'X' }],
    } as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('PROCEDURE_CATALOG_INVALID');
    expect(prismaMock.procedureDocument.upsert).not.toHaveBeenCalled();
  });

  it('magic byte mismatch returns 415', async () => {
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const fakeJpeg = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'passeport.jpg', {
      type: 'image/jpeg',
    });
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: fakeJpeg }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(415);
  });

  it('storage not configured returns 503', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    prismaMock.procedure.findUnique.mockResolvedValue(PROCEDURE_ROW as never);
    prismaMock.procedureAccess.findUnique.mockResolvedValue({ tier: 'COMPLET' } as never);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(503);
  });

  it('csrf failure returns 403 before touching the DB', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ checklistItemId: 'passeport-valide', file: jpeg() }) as never,
      ctxFor('campus-france'),
    );
    expect(res.status).toBe(403);
    expect(prismaMock.procedure.findUnique).not.toHaveBeenCalled();
  });
});
