"use client";

import { ROUTES } from "@/config/routes";
import { ORIGINALS_KEPT_DAYS } from "@/config/localMedia";
import type { LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";
import { useStudioT } from "./studioI18n";

/**
 * "This video's photos and clips are no longer in the app — start a new video."
 *
 * The app keeps a private copy of every picked photo and clip, and every render
 * reads that copy. The copy is kept ORIGINALS_KEPT_DAYS days
 * (config/localMedia.ts), and can also disappear sooner: reinstalling the app,
 * clearing its data, or the phone freeing space.
 *
 * Tho, 27 Sep: picking the files again is NOT offered any more. A request is
 * priced for one set of AI work, and rebuilding it later would spend that
 * again, so the way on is a new video. While this panel shows, the studio's
 * Render and Channels buttons are disabled (there is nothing to render from),
 * and the server refuses to start a render past the keep window. The videos
 * already made stay available: download them or migrate them to Channel
 * Management.
 */
export function MissingOriginals({ missing }: { missing: LocalMediaDescriptor[] }) {
  const t = useStudioT();
  if (missing.length === 0) return null;

  return (
    <section className="studio-panel studio-note-danger" role="alert">
      <h2 className="studio-panel-title">{t("studio.originals.goneTitle")}</h2>
      <p className="studio-panel-hint">
        {t("studio.originals.goneBody", { days: ORIGINALS_KEPT_DAYS })}
      </p>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
        {missing.map((item) => (
          <li key={item.localId}>{item.fileName}</li>
        ))}
      </ul>
      <p className="studio-panel-hint">{t("studio.originals.goneKeep")}</p>
      {/* A full page load, so the studio starts clean rather than carrying
          this request's state into the new one. */}
      <a href={ROUTES.STUDIO} className="studio-button studio-button-primary">
        {t("studio.originals.newVideo")}
      </a>
    </section>
  );
}
