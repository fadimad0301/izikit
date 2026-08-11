import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const uploadStreamMock = vi.fn();
const privateDownloadUrlMock = vi.fn(
  () => 'https://api.cloudinary.com/v1_1/test/image/download?signature=x',
);

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: (
        options: Record<string, unknown>,
        cb: (err: unknown, res: unknown) => void,
      ) => {
        uploadStreamMock(options);
        return {
          end: (_body: Buffer) => {
            cb(null, {
              public_id: options.public_id,
              secure_url: `https://res.cloudinary.com/test/authenticated/upload/${options.public_id}`,
              bytes: 4,
              resource_type: 'image',
            });
          },
        };
      },
    },
    utils: {
      private_download_url: privateDownloadUrlMock,
    },
  },
}));

beforeEach(() => {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
  uploadStreamMock.mockClear();
  privateDownloadUrlMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('uploadAuthenticatedBuffer', () => {
  it('uploads with type: authenticated and overwrite: true', async () => {
    const { uploadAuthenticatedBuffer } = await import('./cloudinary-client');
    const result = await uploadAuthenticatedBuffer(
      'procedures/u1/p1/item1',
      Buffer.from('abcd'),
      'image/jpeg',
    );
    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: 'procedures/u1/p1/item1',
        type: 'authenticated',
        overwrite: true,
      }),
    );
    expect(result.resourceType).toBe('image');
    expect(result.publicId).toBe('procedures/u1/p1/item1');
  });
});

describe('getSignedDeliveryUrl', () => {
  it('calls Cloudinary private_download_url with type authenticated and the given expiry', async () => {
    const { getSignedDeliveryUrl } = await import('./cloudinary-client');
    const url = getSignedDeliveryUrl('procedures/u1/p1/item1', 'image', 1234567890);
    expect(privateDownloadUrlMock).toHaveBeenCalledWith(
      'procedures/u1/p1/item1',
      '',
      expect.objectContaining({
        type: 'authenticated',
        resource_type: 'image',
        expires_at: 1234567890,
      }),
    );
    expect(url).toContain('cloudinary.com');
  });
});
