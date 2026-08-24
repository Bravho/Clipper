"use client";

import { useEffect, useState } from "react";
import {
  forceReloadFresh,
  isStaleShellError,
  recoverStaleShell,
} from "@/lib/client/appRecovery";

/**
 * Last-resort boundary: catches errors thrown by the ROOT LAYOUT itself, which
 * `error.tsx` cannot — it lives inside that layout. This is the case that
 * actually bites in the WebView, because the root layout mounts the client
 * components that a stale deployment's chunks belong to (SessionProvider, the
 * push/service-worker registrars, Navbar). If one of those chunks fails to
 * load, `error.tsx` never gets a chance to render.
 *
 * Replaces the whole document, so it must supply its own <html>/<body> and
 * cannot rely on the app's Tailwind layer being present — styles are inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [recovering, setRecovering] = useState(() => isStaleShellError(error));

  useEffect(() => {
    console.error("[global-error]", error, error.digest ? `digest=${error.digest}` : "");
    if (!isStaleShellError(error)) return;

    let cancelled = false;
    void recoverStaleShell(error.message).then((reloading) => {
      if (!reloading && !cancelled) setRecovering(false);
    });
    return () => {
      cancelled = true;
    };
  }, [error]);

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Thai', sans-serif",
        }}
      >
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          {recovering ? (
            <p style={{ fontSize: 14, color: "#64748b" }}>กำลังโหลดแอปเวอร์ชันล่าสุด…</p>
          ) : (
            <>
              <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
                เปิดแอปไม่สำเร็จ
              </h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 20px" }}>
                แอปโหลดไม่ครบ ข้อมูลและไฟล์ที่อัปโหลดไว้แล้วยังอยู่ครบ
                กด &ldquo;โหลดแอปใหม่&rdquo; เพื่อดึงเวอร์ชันล่าสุด
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => void forceReloadFresh()}
                  style={{
                    border: 0,
                    borderRadius: 6,
                    background: "#1d4ed8",
                    color: "#fff",
                    fontSize: 14,
                    padding: "10px 16px",
                  }}
                >
                  โหลดแอปใหม่
                </button>
                <button
                  type="button"
                  onClick={() => reset()}
                  style={{
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "transparent",
                    color: "#334155",
                    fontSize: 14,
                    padding: "10px 16px",
                  }}
                >
                  ลองอีกครั้ง
                </button>
              </div>
              {error.digest && (
                <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 16 }}>
                  รหัสอ้างอิง: {error.digest}
                </p>
              )}
            </>
          )}
        </div>
      </body>
    </html>
  );
}
