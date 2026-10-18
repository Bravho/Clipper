"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { campaignPathFromQr } from "@/features/campaigns/campaignClient";

/**
 * In-app QR scanner for shop campaigns — a web page inside the app, so no new
 * native plugin and no new app build.
 *
 * The live camera comes from `getUserMedia` (WKWebView on iOS 14.3+, Android
 * WebView through Capacitor's permission bridge). Frames are decoded with the
 * platform `BarcodeDetector` where it exists (Android) and with jsQR elsewhere
 * (iOS). If the camera will not open, "Take a photo of the QR" uses the
 * ordinary camera input and decodes the still.
 */

type DetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

async function makeDetector(): Promise<DetectorLike | null> {
  const Detector = (globalThis as unknown as {
    BarcodeDetector?: {
      new (options: { formats: string[] }): DetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Detector({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

async function decodeWithJsQr(canvas: HTMLCanvasElement): Promise<string | null> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const { default: jsQR } = await import("jsqr");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
  return found?.data ?? null;
}

export function QrScanner() {
  const { t } = useI18n();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "scanning" | "noCamera" | "found">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const handleText = useCallback(
    (text: string): boolean => {
      const path = campaignPathFromQr(text, window.location.origin);
      if (!path) {
        setMessage(t("scan.notCampaign"));
        return false;
      }
      setState("found");
      setMessage(t("scan.found"));
      stopCamera();
      router.push(path);
      return true;
    },
    [router, stopCamera, t]
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRejected = "";

    async function start() {
      setState("starting");
      setMessage(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("noCamera");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play().catch(() => undefined);
        setState("scanning");
        const detector = await makeDetector();

        const tick = async () => {
          if (cancelled || !videoRef.current || !canvasRef.current) return;
          const v = videoRef.current;
          if (v.readyState >= 2 && v.videoWidth > 0) {
            let text: string | null = null;
            try {
              if (detector) {
                const codes = await detector.detect(v);
                text = codes[0]?.rawValue ?? null;
              } else {
                const canvas = canvasRef.current;
                // Decode a centred square, downscaled: fast and enough for a QR.
                const side = Math.min(v.videoWidth, v.videoHeight);
                const size = Math.min(640, side);
                canvas.width = size;
                canvas.height = size;
                canvas
                  .getContext("2d", { willReadFrequently: true })
                  ?.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, size, size);
                text = await decodeWithJsQr(canvas);
              }
            } catch {
              text = null;
            }
            if (text && text !== lastRejected) {
              if (handleText(text)) return;
              lastRejected = text;
            }
          }
          timer = setTimeout(() => void tick(), 220);
        };
        void tick();
      } catch {
        if (!cancelled) setState("noCamera");
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopCamera();
    };
  }, [attempt, handleText, stopCamera]);

  const onPhoto = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setMessage(null);
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = canvasRef.current ?? document.createElement("canvas");
        const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const detector = await makeDetector();
        const text = detector
          ? (await detector.detect(canvas))[0]?.rawValue ?? (await decodeWithJsQr(canvas))
          : await decodeWithJsQr(canvas);
        if (!text) {
          setMessage(t("scan.noCodeInPhoto"));
          return;
        }
        handleText(text);
      } catch {
        setMessage(t("scan.noCodeInPhoto"));
      }
    },
    [handleText, t]
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("scan.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("scan.hint")}</p>
      </div>

      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-slate-900">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {state === "scanning" && (
          <div className="pointer-events-none absolute inset-[14%] rounded-xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        )}
        {state !== "scanning" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/90">
            {state === "starting" ? t("scan.starting") : state === "found" ? t("scan.found") : t("scan.noCamera")}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {message && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 active:bg-slate-50">
          {t("scan.photoInstead")}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              void onPhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        {(state === "noCamera" || message) && state !== "found" && (
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-blue-700"
          >
            {t("scan.retry")}
          </button>
        )}
      </div>
    </div>
  );
}
