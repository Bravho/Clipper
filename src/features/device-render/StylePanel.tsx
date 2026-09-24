"use client";

import type { MotionTemplate } from "@/config/motionTemplates";
import type { EditorDocument } from "./editorState";
import { TemplateExample } from "./TemplateExample";

// English names for the studio's English screen. The ids are the server's;
// the catalogue's own names are Thai and stay on the request page.
const LOOK_NAMES: Record<string, { name: string; description: string }> = {
  none: { name: "Clean", description: "Full-screen video with captions and nothing else." },
  clean_frame: {
    name: "Minimal frame",
    description: "White corner brackets, a faint ripple and an accent bar.",
  },
  framed_cream: {
    name: "Warm frame",
    description: "The video in a rounded window on a warm background, with fine line art.",
  },
  editorial: {
    name: "Editorial",
    description: "A hairline border, soft top and bottom shading and a small accent mark.",
  },
};

/**
 * Graphic: the Look the captions and decoration are drawn in.
 *
 * Each option shows an example frame made from this request's own first
 * picture at the shape being made (`TemplateExample`), because a template can
 * only be judged against the footage it will sit on. Caption languages moved
 * to Sound, next to the background track: both are chosen before the render
 * and neither changes the picture's layout.
 */
export function StylePanel({
  document,
  templates,
  ratio,
  onTemplate,
  graphicConfirmed,
  onConfirm,
  locked,
  disabled,
}: {
  document: EditorDocument;
  templates: MotionTemplate[];
  /** The shape of the main video, which the example frames are drawn at. */
  ratio: string;
  onTemplate: (templateId: string) => void;
  graphicConfirmed: boolean;
  onConfirm: () => void;
  /** Production has started: the Look is what is being rendered. */
  locked: boolean;
  disabled: boolean;
}) {
  // The first picture of the edit — a photo, or a clip's poster frame.
  const firstShot = document.scenes.flatMap((scene) => scene.shots)[0];
  const picture =
    document.sources.find((source) => source.id === firstShot?.sourceId) ?? document.sources[0];
  const pictureUrl = picture?.posterUrl ?? (picture?.kind === "image" ? picture.previewUrl : null);

  return (
    <section className="studio-panel">
      <h2 className="studio-panel-title">Look</h2>
      <p className="studio-panel-hint">
        Example frames from your own material. Decoration that moves in the video is shown at
        rest; accent colours are matched to your script when it renders.
      </p>

      <div className="studio-look-grid" role="radiogroup" aria-label="Look">
        {templates.map((template) => {
          const selected = document.templateId === template.id;
          const words = LOOK_NAMES[template.id] ?? {
            name: template.name,
            description: template.description,
          };
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || locked}
              onClick={() => onTemplate(template.id)}
              className="studio-look"
            >
              <TemplateExample template={template} pictureUrl={pictureUrl} ratio={ratio} height={200} />
              <span className="studio-look-name">
                {selected ? "✓ " : ""}
                {words.name}
              </span>
              <span className="studio-look-description">{words.description}</span>
            </button>
          );
        })}
      </div>

      <div className="studio-approve">
        <button
          type="button"
          className="studio-button studio-button-primary"
          disabled={disabled}
          onClick={onConfirm}
        >
          {graphicConfirmed ? "Confirmed — continue to Render" : "Confirm the look"}
        </button>
        <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
          {locked
            ? "In production — this is the look being rendered."
            : "Next: render the main video on this phone."}
        </p>
      </div>
    </section>
  );
}
