"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

import { useI18n } from "@/i18n/client";
import { supportsManifestRender } from "@/lib/mobile/deviceRenderBridge";
import {
  checkDeviceRenderAvailability,
  runDeviceRender,
  type DeviceRenderAvailability,
  type DeviceRenderProgress,
} from "@/lib/mobile/deviceRenderClient";
import { loadLocalMediaIndex } from "@/features/requests/localMediaStore";
import {
  gateForDevice,
  phaseMessage,
  refusalMessage,
  shouldAttemptRender,
  type RunnerGate,
} from "@/features/requests/deviceRenderRunner";

/**
 * The renderer, living inside the flow the requester already knows.
 *
 * WHAT THIS REPLACES. There used to be a separate "Device Render Lab" screen
 * with its own clip picker, its own trim fields and its own audio panel — a
 * second, weaker editor sitting beside the real one. It could never catch up:
 * the storyboard, the per-scene script gate, the voice approval, the music bed,
 * the subtitle languages, the motion template, the channel ratios and the cover
 * frame all live in the approval panels on this page and are backed by the job
 * record. Rebuilding them on a phone would have meant maintaining two of
 * everything and shipping the worse one to mobile.
 *
 * So the phone does not get its own editor. It gets this: a renderer that
 * attaches to the request the requester is already looking at and runs
 * whichever step the pipeline has queued. Every feature of the full flow is
 * present on the phone by construction, because it IS the full flow.
 *
 * WHY IT RUNS BY ITSELF. Requests whose originals stayed on the phone enqueue
 * their render steps as `device_only`; the Mac Mini worker's claim scan skips
 * them, because it has no copy of the footage. If this component waited to be
 * asked, the job would wait forever. So it claims on its own as soon as a step
 * is queued, and the requester's only decision is the one worth offering: stop,
 * and let the server take over instead.
 */
export function DeviceRenderRunner({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const router = useRouter();

  const [gate, setGate] = useState<RunnerGate | null>(null);
  const [availability, setAvailability] = useState<DeviceRenderAvailability | null>(null);
  const [progress, setProgress] = useState<DeviceRenderProgress | null>(null);
  const [paused, setPaused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const busy = useRef(false);
  // Lets a finished render start the next one without waiting out a poll. A
  // montage is one task PER SCENE, so a six-scene video would otherwise spend a
  // minute doing nothing at all, in twelve-second slices the requester watches.
  const tickRef = useRef<(() => Promise<void>) | null>(null);
  const cancelling = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    let live = true;
    void (async () => {
      const decided = gateForDevice({
        isNative: Capacitor.isNativePlatform(),
        canRenderManifest: Capacitor.isNativePlatform()
          ? await supportsManifestRender()
          : false,
      });
      if (live) setGate(decided);
    })();
    return () => {
      live = false;
    };
  }, []);

  const tick = useCallback(async () => {
    if (!gate || busy.current) return;

    const current = await checkDeviceRenderAvailability(requestId);
    setAvailability(current);

    if (
      !shouldAttemptRender({
        gate,
        paused: pausedRef.current,
        busy: busy.current,
        visible: document.visibilityState === "visible",
        available: current.available,
      })
    ) {
      return;
    }

    busy.current = true;
    cancelling.current = false;
    setFailure(null);
    let chained = false;
    try {
      const outcome = await runDeviceRender({
        requestId,
        // Resolved from the phone's own index rather than from React state: the
        // requester may have picked this media days ago, in another session.
        localMedia: await loadLocalMediaIndex(),
        onProgress: setProgress,
        shouldCancel: () => cancelling.current,
      });

      if (outcome.status === "completed") {
        // More may already be queued: a montage is one task per scene, and the
        // master and final export follow the same claim path.
        chained = true;
        // The pipeline has moved; the panels on this page are server-rendered
        // from the job, so they need the new state before the next step can be
        // approved. A refresh is also what surfaces the finished video.
        router.refresh();
      } else if (outcome.status === "failed") {
        setFailure(outcome.reason ?? "unknown");
        // A failed device render is not a failed video: the task went back to
        // the queue on release. Stop claiming so the phone does not spend the
        // requester's battery failing the same step over and over.
        setPaused(true);
      } else if (outcome.status === "released") {
        setPaused(true);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPaused(true);
    } finally {
      busy.current = false;
      setProgress(null);
    }

    if (chained) void tickRef.current?.();
  }, [gate, requestId, router]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!gate) return;
    let live = true;
    const run = () => {
      if (live) void tick();
    };
    run();
    // Human-speed polling. What changes the answer is an approval the requester
    // makes with their thumb, or a step this phone just finished; neither needs
    // a tighter loop than this, and a phone that polls hard is a phone that
    // runs out of battery before the render does.
    const timer = setInterval(run, 12_000);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [gate, tick]);

  if (!gate) return null;

  if (gate.kind !== "ready") {
    return (
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">{t("deviceRender.title")}</p>
        <p className="mt-1 text-sm text-amber-800">{t(gate.message)}</p>
      </div>
    );
  }

  const phaseKey = progress ? phaseMessage(progress.phase) : null;
  const refusalKey = refusalMessage(availability?.reason);
  const idle =
    !progress && (!availability?.available || availability?.reason === "no_render_queued");

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
      <div className="flex items-center gap-2">
        {progress && (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        )}
        <p className="text-sm font-semibold text-blue-900">{t("deviceRender.title")}</p>
      </div>

      <p className="mt-1 text-xs text-blue-700">{t("deviceRender.explain")}</p>

      {progress && (
        <div className="mt-3">
          <p className="text-sm text-blue-800">
            {phaseKey ? t(phaseKey) : progress.message}
            {progress.percent > 0 ? ` — ${Math.round(progress.percent)}%` : ""}
          </p>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100"
            role="progressbar"
            aria-valuenow={Math.round(progress.percent)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-blue-600">{t("deviceRender.keepOpen")}</p>
        </div>
      )}

      {!progress && paused && (
        <p className="mt-2 text-sm text-blue-800">{t("deviceRender.stopped")}</p>
      )}

      {!progress && !paused && idle && (
        <p className="mt-2 text-sm text-blue-800">{t("deviceRender.waiting")}</p>
      )}

      {!progress && !paused && !idle && refusalKey && (
        <p className="mt-2 text-sm text-blue-800">
          {t("deviceRender.refused", { reason: t(refusalKey) })}
        </p>
      )}

      {failure && (
        <p className="mt-2 text-sm text-rose-700">
          {t("deviceRender.failed", { reason: failure })}
        </p>
      )}

      <div className="mt-3">
        {paused ? (
          <button
            type="button"
            onClick={() => {
              setFailure(null);
              setPaused(false);
            }}
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
          >
            {t("deviceRender.resume")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              // Takes effect at the renderer's next checkpoint; the client
              // releases the lease on the way out, so the task keeps its place
              // in the queue instead of waiting out a lease it will not use.
              cancelling.current = true;
              setPaused(true);
            }}
            className="min-h-[44px] rounded-lg border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700"
          >
            {t("deviceRender.stop")}
          </button>
        )}
      </div>
    </div>
  );
}

export default DeviceRenderRunner;
