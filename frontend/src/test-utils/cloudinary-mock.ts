// Mock Cloudinary client factory.
//
// The upload route test injects this via `vi.mock('@/lib/server/upload/cloudinary-client')`
// so the real Cloudinary SDK never gets called in a test process.
//
// Tests can override the upload branch by passing `onUpload` — passing a
// vi.fn that throws lets a test simulate Cloudinary 5xx, network failures,
// etc. Default returns a happy `{ publicId, secureUrl, bytes }` shape.
import { vi, type Mock } from 'vitest';

export interface MockCloudinaryOptions {
  /**
   * Override for `uploadBuffer`. If omitted, returns a happy
   * `{ publicId, secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/<id>', bytes }`.
   * Throw to simulate upload failure.
   */
  onUpload?: Mock;
  /** Override for `uploadAuthenticatedBuffer`. Same default shape as `onUpload`, plus `resourceType: 'image'`. */
  onUploadAuthenticated?: Mock;
  /** Override for `getSignedDeliveryUrl`. Defaults to a deterministic fake signed URL string. */
  onGetSignedDeliveryUrl?: Mock;
}

export interface MockUploadResult {
  publicId: string;
  secureUrl: string;
  bytes: number;
}

export interface MockCloudinaryClient {
  uploadBuffer: (publicId: string, body: Buffer) => Promise<MockUploadResult>;
  uploadAuthenticatedBuffer: (
    publicId: string,
    body: Buffer,
  ) => Promise<MockUploadResult & { resourceType: string }>;
  getSignedDeliveryUrl: (publicId: string, resourceType: string, expiresAt: number) => string;
}

/**
 * Build a mock Cloudinary uploader. Inject via:
 * `vi.mock('@/lib/server/upload/cloudinary-client', () => ({
 *   uploadBuffer: vi.fn((id, body) => mockCloudinaryClient().uploadBuffer(id, body)),
 *   StorageNotConfiguredError: class extends Error { ... },
 * }))`.
 */
export function mockCloudinaryClient(opts: MockCloudinaryOptions = {}): MockCloudinaryClient {
  return {
    uploadBuffer: vi.fn(async (publicId: string, body: Buffer) => {
      if (opts.onUpload) return (await opts.onUpload(publicId, body)) as MockUploadResult;
      return {
        publicId,
        secureUrl: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}`,
        bytes: body.length,
      };
    }),
    uploadAuthenticatedBuffer: vi.fn(async (publicId: string, body: Buffer) => {
      if (opts.onUploadAuthenticated) {
        return (await opts.onUploadAuthenticated(publicId, body)) as MockUploadResult & {
          resourceType: string;
        };
      }
      return {
        publicId,
        secureUrl: `https://res.cloudinary.com/test-cloud/authenticated/upload/${publicId}`,
        bytes: body.length,
        resourceType: 'image',
      };
    }),
    getSignedDeliveryUrl: vi.fn((publicId: string, resourceType: string, expiresAt: number) => {
      if (opts.onGetSignedDeliveryUrl) {
        return opts.onGetSignedDeliveryUrl(publicId, resourceType, expiresAt) as string;
      }
      return `https://api.cloudinary.com/v1_1/test-cloud/${resourceType}/download?public_id=${publicId}&expires_at=${expiresAt}&signature=test-sig`;
    }),
  };
}
