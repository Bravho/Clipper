"use client";

import { useEffect, useState } from "react";
import {
  forceReloadFresh,
  isStaleShellError,
  recoverStaleShell,
} from "@/lib/client/appRecovery";

/**
 * Route-level error boundary for the whole app.
 *
 * Before this file existed the app had NO error boundary at all, so any error
 * thrown while rendering a client component escaped to Next.js's built-in root
 * boundary — the bare white page reading "Application error: a client-side
 * exception has occurred (see the browser console for more information)". In a
 * Capacitor WebView there is no browser console to look at and no address bar
 * to reload from, so that screen is a dead end: the user's only way out is to
 * force-stop the app or clear its data.
 *
 * This boundary does two things instead:
 *   - A stale-shell error (a `_next/static` chunk from a superseded deployment
 *     that no longer resolves) is self-healed: caches are purged and the page
 *     hard-reloads once. This is by far the most common cause in the WebView,
 *     and the user should never have to see it.
 *   - Anything else renders a readable screen with a working retry, so the user
 *     keeps a route back into the app.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // `true` until we know we are NOT auto-recovering, so a recoverable error
  // shows a neutral "reloading" screen rather than flashing an error at the
  // user right before the page reloads under them.
  const [recovering, setRecovering] = useState(() => isStaleShellError(error));

  useEffect(() => {
    console.error("[app-error]", error, error.digest ? `digest=${error.digest}` : "");
    if (!isStaleShellError(error)) return;

    let cancelled = false;
    void recoverStaleShell(error.message).then((reloading) => {
      // Cooldown blocked the reload (the fresh shell threw too) — stop
      // pretending to recover and show the error UI with a manual retry.
      if (!reloading && !cancelled) setRecovering(false);
    });
    return () => {
      cancelled = true;
    };
  }, [error]);

  if (recovering) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
        <p className="text-sm text-slate-500">กำลังโหลดแอปเวอร์ชันล่าสุด…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">เกิดข้อผิดพลาด</h1>
      <p className="text-sm text-slate-500">
        หน้านี้โหลดไม่สำเร็จ ข้อมูลและไฟล์ที่อัปโหลดไว้แล้วยังอยู่ครบ
        ลองใหม่อีกครั้งได้เลย
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white"
        >
          ลองอีกครั้ง
        </button>
        <button
          type="button"
          onClick={() => void forceReloadFresh()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700"
        >
          โหลดแอปใหม่ทั้งหมด
        </button>
      </div>
      {error.digest && (
        <p className="text-[11px] text-slate-400">รหัสอ้างอิง: {error.digest}</p>
      )}
    </div>
  );
}
