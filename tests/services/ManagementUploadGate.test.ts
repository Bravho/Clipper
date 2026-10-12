/**
 * Uploading your own video to Channel Management (2026-10-12): a package is
 * required, a package holder keeps up to MANAGEMENT_UPLOAD_KEEP_LIMIT (50)
 * uploads at once, and each upload is kept 30 days in the paid prefix.
 */
import { S3Client } from "@aws-sdk/client-s3";
import {
  MANAGEMENT_UPLOAD_KEEP_LIMIT,
  ManagementUploadError,
  ManagementUploadService,
} from "@/services/management/ManagementUploadService";
import { ManagementContentStatus, ManagementSourceType } from "@/domain/enums/ManagementStatus";
import { VIDEO_LIFETIME_DAYS } from "@/config/retention";

const DAY = 86_400_000;
const USER = "user-upload-1";

function upload(overrides: Record<string, unknown> = {}) {
  return {
    id: `item-${Math.random()}`,
    userId: USER,
    sourceType: ManagementSourceType.UserUpload,
    status: ManagementContentStatus.Ready,
    mediaDeletedAt: null,
    mediaExpiresAt: new Date(Date.now() + 10 * DAY),
    ...overrides,
  };
}

function setup(opts: { hasPackage: boolean; existing?: unknown[] }) {
  const content = {
    findByUserId: jest.fn(async () => opts.existing ?? []),
    createUploaded: jest.fn(async (input: { mediaExpiresAt: Date }) => ({
      id: "11111111-1111-4111-8111-111111111111",
      userId: USER,
      mediaExpiresAt: input.mediaExpiresAt,
    })),
  };
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: "https://example.invalid",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const service = new ManagementUploadService(
    content as never,
    { record: jest.fn() } as never,
    s3,
    { hasActivePackage: jest.fn(async () => opts.hasPackage) }
  );
  return { service, content };
}

const BEGIN = {
  userId: USER,
  title: "My clip",
  fileName: "clip.mp4",
  fileSizeBytes: 1_000_000,
  mimeType: "video/mp4",
};

describe("Channel Management uploads", () => {
  it("are refused without a package", async () => {
    const { service, content } = setup({ hasPackage: false });
    const refusal = await service.begin(BEGIN).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(ManagementUploadError);
    expect((refusal as ManagementUploadError).code).toBe("package_required");
    expect(content.createUploaded).not.toHaveBeenCalled();
  });

  it("keep at most 50 at once", async () => {
    expect(MANAGEMENT_UPLOAD_KEEP_LIMIT).toBe(50);
    const { service } = setup({
      hasPackage: true,
      existing: Array.from({ length: MANAGEMENT_UPLOAD_KEEP_LIMIT }, () => upload()),
    });
    const refusal = await service.begin(BEGIN).catch((err: unknown) => err);
    expect((refusal as ManagementUploadError).code).toBe("quota_exceeded");
  });

  it("do not count expired, purged or cancelled uploads against the 50", async () => {
    const gone = [
      ...Array.from({ length: 20 }, () => upload({ mediaExpiresAt: new Date(Date.now() - DAY) })),
      ...Array.from({ length: 20 }, () => upload({ mediaDeletedAt: new Date() })),
      ...Array.from({ length: 20 }, () => upload({ status: ManagementContentStatus.Cancelled })),
    ];
    const { service } = setup({ hasPackage: true, existing: gone });
    await expect(service.begin(BEGIN)).resolves.toBeDefined();
  });

  it("go straight into the 30-day prefix with a 30-day expiry", async () => {
    const { service } = setup({ hasPackage: true });
    const before = Date.now();
    const result = await service.begin(BEGIN);
    expect(result.storageKey.startsWith(`management_retained/${USER}/`)).toBe(true);
    const days = ((result.content.mediaExpiresAt as Date).getTime() - before) / DAY;
    expect(days).toBeGreaterThan(VIDEO_LIFETIME_DAYS - 0.01);
    expect(days).toBeLessThan(VIDEO_LIFETIME_DAYS + 0.01);
  });
});
