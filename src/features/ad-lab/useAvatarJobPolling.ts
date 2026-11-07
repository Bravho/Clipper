"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdLabAvatarVideoStatus } from "@/domain/models/AdLab";

export interface AvatarPollingUpdate {
  status: AdLabAvatarVideoStatus;
  error?: string;
  videoKey?: string;
  videoUrl?: string;
  downloadUrl?: string;
  completedAt?: string;
  durationSec?: number;
}

interface UseAvatarJobPollingParams {
  draftId: string | null;
  heygenVideoId: string | null;
  jobToken: string | null;
  status: AdLabAvatarVideoStatus | null;
  onUpdate: (update: AvatarPollingUpdate) => void;
}

export interface UseAvatarJobPollingResult {
  timedOut: boolean;
  checkNow: () => void;
  error: string | null;
  latest: { videoUrl?: string; downloadUrl?: string };
}

const IN_FLIGHT: AdLabAvatarVideoStatus[] = ["queued", "processing", "copying"];
const MAX_CONS_FAILURES = 5;
const REQUEST_TIMEOUT_MS = 20_000;

export function useAvatarJobPolling(
  params: UseAvatarJobPollingParams
): UseAvatarJobPollingResult {
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ videoUrl?: string; downloadUrl?: string }>({});

  const ref = useRef(params);
  ref.current = params;

  // Identity key combines all three fields that uniquely identify a job context.
  const identityKey = `${params.draftId ?? ""}|${params.heygenVideoId ?? ""}|${params.jobToken ?? ""}`;

  const startedAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastDeliveredRef = useRef<{
    status?: AdLabAvatarVideoStatus;
    error?: string;
    videoKey?: string;
    durationSec?: number;
  }>({});
  const consFailRef = useRef(0);
  const triggerRef = useRef<(() => void) | null>(null);

  /**
   * Manual poll trigger. Resets the 30-minute window and the consecutive-failure
   * counter — useful when the user returns after a timeout or error-stop.
   */
  const checkNow = useCallback(() => {
    startedAtRef.current = Date.now();
    setTimedOut(false);
    setError(null);
    consFailRef.current = 0;
    triggerRef.current?.();
  }, []);

  useEffect(() => {
    // Always reset result state when identity changes, BEFORE any early return,
    // so a previous draft's video/download URLs are never shown for another draft.
    setTimedOut(false);
    setError(null);
    setLatest({});
    lastDeliveredRef.current = {};
    consFailRef.current = 0;
    startedAtRef.current = Date.now();

    const { draftId, heygenVideoId, jobToken, status } = ref.current;
    if (!draftId || !heygenVideoId || !jobToken || !status || !IN_FLIGHT.includes(status)) {
      return;
    }

    let cancelled = false;
    let tid: ReturnType<typeof setTimeout> | null = null;
    let retryAfterUntil = 0;
    let activeController: AbortController | null = null;

    async function poll() {
      if (cancelled) return;
      if (inFlightRef.current) return; // serialise — checkNow while in flight is a no-op

      const { draftId: d, heygenVideoId: vid, jobToken: tok, status: st } = ref.current;
      if (!d || !vid || !tok || !st || !IN_FLIGHT.includes(st)) return;

      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed > 30 * 60 * 1000) {
        setTimedOut(true);
        return;
      }

      const now = Date.now();
      if (now < retryAfterUntil) {
        const wait = retryAfterUntil - now;
        if (!cancelled) tid = setTimeout(() => void poll(), wait);
        return;
      }

      const url =
        `/api/ad-lab/avatar/video/${encodeURIComponent(vid)}` +
        `?draftId=${encodeURIComponent(d)}&token=${encodeURIComponent(tok)}`;

      inFlightRef.current = true;
      const controller = new AbortController();
      activeController = controller;
      // Per-request timeout: abort the controller after ~20 s so a hanging fetch
      // or body read cannot block polling forever.
      const reqTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (cancelled) return;
        inFlightRef.current = false;
        activeController = null;

        if (res.status === 429) {
          clearTimeout(reqTimer);
          const secs = parseInt(res.headers.get("Retry-After") ?? "30", 10);
          retryAfterUntil = Date.now() + secs * 1000;
          consFailRef.current = 0;
          if (!cancelled) tid = setTimeout(() => void poll(), secs * 1000);
          return;
        }

        if (!res.ok) {
          // Routes return { error: string, reason: string } (see _avatarGuard.ts).
          const data = await res.json().catch(() => ({})) as { error?: string; reason?: string };
          clearTimeout(reqTimer);
          const reason = data.reason;
          const msg = data.error ?? "การตรวจสอบสถานะล้มเหลว";

          if (res.status >= 400 && res.status < 500) {
            // Stop polling on 4xx client errors.
            if (reason === "invalid_token" || reason === "not_found") {
              ref.current.onUpdate({ status: "failed", error: msg });
            } else {
              setError(msg);
            }
            return;
          }

          // 5xx — retry with back-off; stop after MAX_CONS_FAILURES.
          consFailRef.current++;
          if (consFailRef.current >= MAX_CONS_FAILURES) {
            setError("เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่ภายหลัง");
            return;
          }
          if (!cancelled) tid = setTimeout(() => void poll(), 30_000);
          return;
        }

        consFailRef.current = 0;

        const data = (await res.json()) as {
          status?: string;
          error?: string;
          videoKey?: string;
          videoUrl?: string;
          downloadUrl?: string;
          durationSec?: number;
          retryAfterSeconds?: number;
        };
        clearTimeout(reqTimer);
        if (cancelled) return;

        if (data.retryAfterSeconds) {
          retryAfterUntil = Date.now() + data.retryAfterSeconds * 1000;
          if (!cancelled) tid = setTimeout(() => void poll(), data.retryAfterSeconds * 1000);
          return;
        }

        const mapped: AdLabAvatarVideoStatus =
          data.status === "ready" ? "ready"
          : data.status === "failed" ? "failed"
          : data.status === "copying" ? "copying"
          : data.status === "processing" ? "processing"
          : "queued";

        // Always expose the latest signed URLs (they change on every poll).
        if (data.videoUrl !== undefined || data.downloadUrl !== undefined) {
          setLatest({ videoUrl: data.videoUrl, downloadUrl: data.downloadUrl });
        }

        // Only call onUpdate when meaningful (non-URL) fields changed.
        const last = lastDeliveredRef.current;
        const changed =
          last.status !== mapped ||
          last.error !== data.error ||
          last.videoKey !== data.videoKey ||
          last.durationSec !== data.durationSec;

        if (changed) {
          lastDeliveredRef.current = {
            status: mapped,
            error: data.error,
            videoKey: data.videoKey,
            durationSec: data.durationSec,
          };
          ref.current.onUpdate({
            status: mapped,
            error: data.error,
            videoKey: data.videoKey,
            videoUrl: data.videoUrl,
            downloadUrl: data.downloadUrl,
            completedAt: mapped === "ready" ? new Date().toISOString() : undefined,
            durationSec: data.durationSec,
          });
        }

        if (mapped === "ready" || mapped === "failed") return;

        const elapsed2 = Date.now() - startedAtRef.current;
        const interval = elapsed2 < 3 * 60 * 1000 ? 10_000 : 30_000;
        if (!cancelled) tid = setTimeout(() => void poll(), interval);
      } catch (e) {
        clearTimeout(reqTimer);
        // Only reset the in-flight flag if we are still the active effect; a new
        // effect instance resets it during cleanup before starting its own poll.
        if (!cancelled) {
          inFlightRef.current = false;
          activeController = null;
        }
        if ((e as Error).name === "AbortError") {
          // Distinguish effect teardown (cancelled=true) from per-request timeout.
          if (cancelled) return;
          consFailRef.current++;
          if (consFailRef.current >= MAX_CONS_FAILURES) {
            setError("เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่ภายหลัง");
            return;
          }
          tid = setTimeout(() => void poll(), 30_000);
          return;
        }
        if (cancelled) return;
        consFailRef.current++;
        if (consFailRef.current >= MAX_CONS_FAILURES) {
          setError("เครือข่ายขัดข้อง กรุณาลองใหม่ภายหลัง");
          return;
        }
        tid = setTimeout(() => void poll(), 30_000);
      }
    }

    triggerRef.current = () => {
      if (inFlightRef.current) return; // no-op while a request is in flight
      if (tid) { clearTimeout(tid); tid = null; }
      void poll();
    };

    void poll();
    return () => {
      cancelled = true;
      triggerRef.current = null;
      if (tid) clearTimeout(tid);
      activeController?.abort();
      inFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  return { timedOut, checkNow, error, latest };
}
