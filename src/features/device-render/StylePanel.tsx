"use client";

import type { MotionTemplate } from "@/config/motionTemplates";
import type { EditorDocument } from "./editorState";
import { TemplateExample } from "./TemplateExample";
import { useStudioT, type StudioT } from "./studioI18n";

// The studio's names for the Looks, in its language. The ids are the server's;
// the catalogue's own (Thai) names stay on the request page, and are the
// fallback for a Look the studio has no words for yet.
const LOOK_IDS = new Set(["none", "clean_frame", "framed_cream", "editorial"]);

function lookWords(t: StudioT, template: MotionTemplate): { name: string; description: string } {
  if (!LOOK_IDS.has(template.id)) {
    return { name: template.name, description: template.description };
  }
  const id = template.id as "none";
  return { name: t(`studio.look.${id}.name`), description: t(`studio.look.${id}.description`) };
}

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
  const t = useStudioT();
  // The first picture of the edit — a photo, or a clip's poster frame.
  const firstShot = document.scenes.flatMap((scene) => scene.shots)[0];
  const picture =
    document.sources.find((source) => source.id === firstShot?.sourceId) ?? document.sources[0];
  const pictureUrl = picture?.posterUrl ?? (picture?.kind === "image" ? picture.previewUrl : null);

  return (
    <section className="studio-panel">
      <h2 className="studio-panel-title">{t("studio.look.title")}</h2>
      <p className="studio-panel-hint">{t("studio.look.hint")}</p>

      <div className="studio-look-grid" role="radiogroup" aria-label={t("studio.look.title")}>
        {templates.map((template) => {
          const selected = document.templateId === template.id;
          const words = lookWords(t, template);
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
              <TemplateExample
                template={template}
                pictureUrl={pictureUrl}
                ratio={ratio}
                height={200}
                sampleCaption={t("studio.look.sampleCaption")}
                alt={t("studio.look.exampleAlt", { name: words.name })}
              />
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
          {graphicConfirmed ? t("studio.look.confirmed") : t("studio.look.confirm")}
        </button>
        <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
          {locked
            ? t("studio.look.lockedHint")
            : t("studio.look.next")}
        </p>
      </div>
    </section>
  );
}
