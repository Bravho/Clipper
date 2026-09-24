import {
  gateForDevice,
  phaseMessage,
  refusalMessage,
  shouldAttemptRender,
} from "@/features/requests/deviceRenderRunner";
import { translate } from "@/i18n/messages";
import { SUPPORTED_LOCALES } from "@/i18n/config";

/**
 * The rules that decide whether the requester's phone renders their video.
 *
 * These matter more than their size suggests. A request whose originals stayed
 * on the phone enqueues `device_only` render tasks, which the Mac Mini worker
 * deliberately never claims — it has no copy of the footage. If the phone
 * wrongly decides it is not the renderer, the job has no renderer at all and
 * waits forever; if it wrongly decides it IS, it burns battery being refused.
 */

describe("device render runner", () => {
  describe("which device should render", () => {
    it("renders on a current native build", () => {
      expect(gateForDevice({ isNative: true, canRenderManifest: true })).toEqual({
        kind: "ready",
      });
    });

    it("sends a browser to the phone that holds the originals", () => {
      // The desktop has no copy of the footage. Silence here would leave the
      // requester watching a pipeline that cannot move.
      expect(gateForDevice({ isNative: false, canRenderManifest: false })).toEqual({
        kind: "wrong_device",
        message: "deviceRender.openOnPhone",
      });
    });

    it("tells an older app build to update rather than failing quietly", () => {
      expect(gateForDevice({ isNative: true, canRenderManifest: false })).toEqual({
        kind: "update_app",
        message: "deviceRender.updateApp",
      });
    });
  });

  describe("when a tick claims work", () => {
    const ready = gateForDevice({ isNative: true, canRenderManifest: true });
    const base = { gate: ready, paused: false, busy: false, visible: true, available: true };

    it("claims when everything is in place", () => {
      expect(shouldAttemptRender(base)).toBe(true);
    });

    it("never claims from a backgrounded app", () => {
      // The server refuses a background claim outright: an encoder the OS is
      // about to suspend would hold the lease and produce nothing.
      expect(shouldAttemptRender({ ...base, visible: false })).toBe(false);
    });

    it("never claims twice at once", () => {
      expect(shouldAttemptRender({ ...base, busy: true })).toBe(false);
    });

    it("respects the requester asking it to stop", () => {
      expect(shouldAttemptRender({ ...base, paused: true })).toBe(false);
    });

    it("does not claim when the server has nothing queued", () => {
      expect(shouldAttemptRender({ ...base, available: false })).toBe(false);
    });

    it("does not claim on a device that was gated out", () => {
      expect(
        shouldAttemptRender({
          ...base,
          gate: gateForDevice({ isNative: false, canRenderManifest: false }),
        })
      ).toBe(false);
    });
  });

  describe("what the requester is told", () => {
    it("translates the refusals it has words for", () => {
      const key = refusalMessage("insufficient_storage");
      expect(key).toBe("deviceRender.reason.insufficient_storage");
      for (const locale of SUPPORTED_LOCALES) {
        expect(translate(locale, key!)).not.toHaveLength(0);
      }
    });

    it("keeps an unknown reason honest instead of smoothing it over", () => {
      // The component falls back to printing the raw reason. A reassuring
      // sentence that says nothing would be worse for whoever has to debug it.
      expect(refusalMessage("something_new_from_the_server")).toBeNull();
      expect(refusalMessage(undefined)).toBeNull();
    });

    it("has a phrase for every phase the requester can see", () => {
      for (const phase of ["checking", "claiming", "rendering", "uploading", "finishing", "done"] as const) {
        const key = phaseMessage(phase);
        expect(key).not.toBeNull();
        for (const locale of SUPPORTED_LOCALES) {
          expect(translate(locale, key!)).not.toHaveLength(0);
        }
      }
    });

    it("says nothing for the phases that are not progress", () => {
      // "idle", "released" and "failed" have their own copy; labelling them as
      // a progress phase would show "rendering" next to a stopped render.
      expect(phaseMessage("idle")).toBeNull();
      expect(phaseMessage("failed")).toBeNull();
      expect(phaseMessage("released")).toBeNull();
    });
  });
});
