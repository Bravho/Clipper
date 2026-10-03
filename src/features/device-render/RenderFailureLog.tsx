"use client";

import { useState } from "react";

import { useStudioT } from "./studioI18n";

/**
 * Why the phone's last try at a part stopped, and everything it did first.
 *
 * `summary` is the root cause as one sentence — where it failed ("while making
 * the video on this phone") and what the phone said. `log` is the attempt's
 * step-by-step trail: the app's steps, then the phone renderer's own (each
 * input's size, codec, resolution and HDR; each attempt and fallback; the full
 * Media3 / AVFoundation error chain with the codec that refused). Folded away
 * by default, with a Copy button, so it can be sent to support as it is.
 */
export function RenderFailureLog({
  summary,
  log,
}: {
  summary: string;
  log: string[];
}) {
  const t = useStudioT();
  const [copied, setCopied] = useState(false);
  const text = [summary, "", ...log].join("\n");

  return (
    <div className="studio-note studio-note-danger studio-failure" role="alert">
      <p style={{ margin: 0 }}>
        <strong>{t("studio.failure.lastTry")}</strong>
        {summary}
      </p>
      {log.length > 0 && (
        <details className="studio-failure-log">
          <summary>{t("studio.failure.steps", { count: log.length })}</summary>
          <pre>{log.join("\n")}</pre>
          <button
            type="button"
            className="studio-button studio-button-ghost"
            style={{ width: "auto", minHeight: 36, padding: "6px 12px", fontSize: 13 }}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? t("studio.failure.copied") : t("studio.failure.copy")}
          </button>
        </details>
      )}
    </div>
  );
}
