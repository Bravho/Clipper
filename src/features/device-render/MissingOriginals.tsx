"use client";

import { useState } from "react";

import type { LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";
import { relinkStudioOriginals } from "./studioPipeline";
import { useStudioT } from "./studioI18n";

/**
 * "This phone no longer has your originals — pick them again."
 *
 * The app keeps a private copy of every picked photo and clip, and each render
 * reads that copy. The copy can disappear on its own: reinstalling the app,
 * clearing its data, or Android freeing space. The server only knows the
 * files' names and sizes, so the way back is to pick the same files from the
 * gallery again; they are matched by name and size and put back where the
 * renders look for them.
 */
export function MissingOriginals({
  missing,
  onRestored,
}: {
  missing: LocalMediaDescriptor[];
  /** Called after a pick, with the originals still missing. */
  onRestored: (stillMissing: LocalMediaDescriptor[]) => void | Promise<void>;
}) {
  const t = useStudioT();
  const [working, setWorking] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (missing.length === 0) return null;

  const pick = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setNote(null);
    setWorking({ done: 0, total: list.length });
    try {
      const result = await relinkStudioOriginals(missing, list, (done, total) =>
        setWorking({ done, total })
      );
      const parts: string[] = [];
      if (result.restored > 0) parts.push(t("studio.originals.restored", { count: result.restored }));
      if (result.unused.length > 0) {
        parts.push(t("studio.originals.unused", { names: result.unused.join(", ") }));
      }
      setNote(parts.join(" ") || null);
      await onRestored(result.stillMissing);
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="studio-panel studio-note-danger" role="alert">
      <h2 className="studio-panel-title">{t("studio.originals.title")}</h2>
      <p className="studio-panel-hint">{t("studio.originals.body")}</p>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
        {missing.map((item) => (
          <li key={item.localId}>{item.fileName}</li>
        ))}
      </ul>
      <label className="studio-button studio-button-primary" aria-disabled={working !== null}>
        {working
          ? t("studio.originals.working", { done: working.done, total: working.total })
          : t("studio.originals.pick")}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          multiple
          disabled={working !== null}
          onChange={(event) => {
            const input = event.target;
            void pick(input.files).finally(() => {
              input.value = "";
            });
          }}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      </label>
      {note && (
        <p className="studio-counter" style={{ textAlign: "left", marginTop: 8 }}>
          {note}
        </p>
      )}
    </section>
  );
}
