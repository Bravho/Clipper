import {
  hasDeviceHeldClips,
  localMediaSubmissionSchema,
} from "@/lib/mobile/localMediaContract";
import {
  MANIFEST_RENDER_PLUGIN_VERSION,
  canRenderManifestOnDevice,
} from "@/lib/mobile/deviceRenderPluginVersion";

/**
 * Who is allowed to keep their footage on their phone.
 *
 * The rule is asymmetric on purpose. A PHOTO can stay local whatever the app
 * build is: the server keeps a faithful derivative and can render from it, so
 * the Mac Mini path still works. A CLIP cannot — the only copy of its moving
 * frames is on the device, so if that device cannot render, nothing can, and
 * the request would sit in the queue forever with no possible worker.
 *
 * These tests pin that asymmetry, because getting it wrong in either direction
 * is expensive: too strict and every phone keeps uploading hundreds of
 * megabytes; too loose and an old app build strands a paid request.
 */

function submission(materials: { mimeType: string; localId: string }[], deviceRender?: unknown) {
  return {
    mode: "local-first" as const,
    materials: materials.map((material, index) => ({
      localId: material.localId,
      fileName: `file-${index}.bin`,
      mimeType: material.mimeType,
      fileSizeBytes: 1000,
      durationSeconds: material.mimeType.startsWith("video/") ? 8 : null,
    })),
    analysisFrames: materials.map((material, index) => ({
      localId: material.localId,
      assetIndex: index,
      mimeType: "image/jpeg" as const,
      // A minimal valid base64 payload; the contract only checks its shape.
      dataBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==",
    })),
    ...(deviceRender ? { deviceRender } : {}),
  };
}

describe("device-held media policy", () => {
  describe("detecting moving footage", () => {
    it("is true when any material is a clip", () => {
      expect(
        hasDeviceHeldClips({
          materials: [{ mimeType: "image/jpeg" }, { mimeType: "video/mp4" }],
        })
      ).toBe(true);
    });

    it("is false for photos alone", () => {
      expect(
        hasDeviceHeldClips({ materials: [{ mimeType: "image/jpeg" }, { mimeType: "image/png" }] })
      ).toBe(false);
    });
  });

  describe("the version gate", () => {
    it("admits exactly the build that can render a whole manifest", () => {
      expect(canRenderManifestOnDevice(MANIFEST_RENDER_PLUGIN_VERSION)).toBe(true);
      expect(canRenderManifestOnDevice(MANIFEST_RENDER_PLUGIN_VERSION + 1)).toBe(true);
      expect(canRenderManifestOnDevice(MANIFEST_RENDER_PLUGIN_VERSION - 1)).toBe(false);
    });

    it("treats an app that says nothing as one that cannot render", () => {
      // An older build predates the field entirely. Absent must mean "no", or
      // every app that has never heard of device rendering would be trusted to
      // do it.
      expect(canRenderManifestOnDevice(null)).toBe(false);
      expect(canRenderManifestOnDevice(undefined)).toBe(false);
      expect(canRenderManifestOnDevice(0)).toBe(false);
    });
  });

  describe("the submission contract", () => {
    it("accepts a photo-only submission with no capability declared", () => {
      // This is the older-app path, and it must keep working untouched: photos
      // stay local, the server renders from its derivatives on the Mac Mini.
      const parsed = localMediaSubmissionSchema.safeParse(
        submission([{ mimeType: "image/jpeg", localId: "a" }])
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.deviceRender).toBeUndefined();
    });

    it("carries the declaration when a current build sends one", () => {
      const parsed = localMediaSubmissionSchema.safeParse(
        submission([{ mimeType: "video/mp4", localId: "a" }], {
          nativePluginVersion: MANIFEST_RENDER_PLUGIN_VERSION,
          canRenderManifest: true,
          platform: "android",
        })
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.deviceRender?.canRenderManifest).toBe(true);
        expect(parsed.data.deviceRender?.platform).toBe("android");
      }
    });

    it("rejects a malformed capability rather than reading it as absent", () => {
      // A declaration that does not parse must fail loudly. Silently dropping it
      // would downgrade a capable phone to the upload path with no explanation.
      const parsed = localMediaSubmissionSchema.safeParse(
        submission([{ mimeType: "video/mp4", localId: "a" }], {
          nativePluginVersion: "five",
          canRenderManifest: true,
          platform: "android",
        })
      );
      expect(parsed.success).toBe(false);
    });

    it("rejects a platform the render path does not exist for", () => {
      const parsed = localMediaSubmissionSchema.safeParse(
        submission([{ mimeType: "video/mp4", localId: "a" }], {
          nativePluginVersion: MANIFEST_RENDER_PLUGIN_VERSION,
          canRenderManifest: true,
          platform: "web",
        })
      );
      expect(parsed.success).toBe(false);
    });
  });

  describe("what the submit route decides", () => {
    // The route's rule, restated here so a change to it has to change a test
    // that says what it is for.
    const mayKeepClipsLocally = (declared?: {
      nativePluginVersion: number;
      canRenderManifest: boolean;
    }) =>
      Boolean(declared?.canRenderManifest) &&
      canRenderManifestOnDevice(declared?.nativePluginVersion);

    it("lets a current build keep its clips", () => {
      expect(
        mayKeepClipsLocally({
          nativePluginVersion: MANIFEST_RENDER_PLUGIN_VERSION,
          canRenderManifest: true,
        })
      ).toBe(true);
    });

    it("sends an older build back to the upload path", () => {
      expect(
        mayKeepClipsLocally({
          nativePluginVersion: MANIFEST_RENDER_PLUGIN_VERSION - 1,
          canRenderManifest: true,
        })
      ).toBe(false);
      expect(mayKeepClipsLocally(undefined)).toBe(false);
    });

    it("believes a capable version that admits it cannot render", () => {
      // A phone with no H.264 encoder reports the right version and still says
      // no. The honest answer wins over the version number.
      expect(
        mayKeepClipsLocally({
          nativePluginVersion: MANIFEST_RENDER_PLUGIN_VERSION,
          canRenderManifest: false,
        })
      ).toBe(false);
    });
  });
});
