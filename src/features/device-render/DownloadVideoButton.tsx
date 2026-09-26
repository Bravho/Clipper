"use client";

import { useState } from "react";

import { downloadStudioVideo } from "./downloadVideo";
import { useStudioT } from "./studioI18n";

/** A finished video's download button, with its own busy and error state. */
export function DownloadVideoButton({
  requestId,
  assetId,
  channel,
  label,
}: {
  requestId: string;
  assetId: string;
  channel?: string;
  label?: string;
}) {
  const t = useStudioT();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  const download = async () => {
    setDownloading(true);
    setPercent(null);
    setError(null);
    try {
      await downloadStudioVideo({
        requestId,
        assetId,
        channel,
        failedMessage: t("studio.download.failed"),
        onProgress: (fraction) => setPercent(Math.round(fraction * 100)),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="studio-download">
      <button
        type="button"
        className="studio-button studio-button-ghost"
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading
          ? percent != null && percent < 100
            ? t("studio.download.progress", { percent })
            : t("studio.download.preparing")
          : (label ?? t("studio.download.default"))}
      </button>
      {error && (
        <p className="studio-note studio-note-danger" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** What the Render and Channels steps need to offer "Resume rendering". */
export interface ResumeControls {
  /** Seconds until the interrupted render can be taken back, or null if it can be now. */
  waitSeconds: number | null;
  disabled: boolean;
  onResume: () => void;
}

/**
 * The render stopped — the app was closed, Stop was pressed, or a part failed —
 * and the finished parts are safe on the server. Resume carries on from the
 * part that was in progress.
 */
export function ResumeCallout({ resume, what }: { resume: ResumeControls; what: string }) {
  const t = useStudioT();
  return (
    <div className="studio-note studio-note-warning studio-resume" role="status">
      <p style={{ margin: 0 }}>
        <strong>{t("studio.resume.paused")}</strong> {t("studio.resume.body", { what })}
        {resume.waitSeconds != null && resume.waitSeconds > 0
          ? t("studio.resume.wait", { seconds: resume.waitSeconds })
          : ""}
      </p>
      <button
        type="button"
        className="studio-button studio-button-primary"
        style={{ marginTop: 10 }}
        disabled={resume.disabled}
        onClick={resume.onResume}
      >
        {t("studio.editor.resume")}
      </button>
    </div>
  );
}
