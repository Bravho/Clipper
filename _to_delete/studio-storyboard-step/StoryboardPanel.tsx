"use client";

import type { StoryboardPlan, StoryboardPlanScene } from "@/lib/mobile/deviceStoryboard";
import type { EditorSource } from "./editorState";
import { MediaThumb } from "./MediaThumb";

/**
 * The plan, before any of it is committed to the timeline.
 *
 * WHY A SEPARATE STEP AND NOT A BUTTON ON THE TIMELINE. What comes back from
 * the model is a proposal about MEANING — this scene introduces the shop, that
 * one shows the noodles — and the only person who can say whether it is right is
 * the one who was standing there. Dropping it straight onto the timeline would
 * mix that judgement up with trims and camera moves, and make "was this the
 * plan I approved?" impossible to answer. So the storyboard is reviewed as a
 * storyboard, and applying it is a deliberate act with a button of its own.
 *
 * WHY APPLYING REPLACES THE TIMELINE. A merge would have to guess which of the
 * existing shots corresponded to which new scene, and it would guess wrong. The
 * panel says plainly what the button will do before it is pressed.
 *
 * REORDERING AND RESELECTING ARE BOTH HERE because they are the two edits that
 * actually get made: the model puts a good shot in the wrong place, or picks the
 * blurry one of two near-identical photos. Everything else is faster to fix on
 * the timeline afterwards.
 */
export function StoryboardPanel({
  sources,
  plan,
  generating,
  error,
  canGenerate,
  onGenerate,
  onPlanChange,
  onApply,
  disabled,
}: {
  sources: EditorSource[];
  plan: StoryboardPlan | null;
  generating: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onPlanChange: (scenes: StoryboardPlanScene[]) => void;
  onApply: () => void;
  disabled: boolean;
}) {
  const scenes = plan?.scenes ?? [];

  // Scenes are always renumbered contiguously on the way out, so the numbers on
  // screen and the numbers in the data can never drift apart.
  const commit = (next: StoryboardPlanScene[]) =>
    onPlanChange(next.map((scene, index) => ({ ...scene, sceneNumber: index + 1 })));

  const setSummary = (index: number, summary: string) =>
    commit(scenes.map((scene, i) => (i === index ? { ...scene, summary } : scene)));

  const toggleAsset = (index: number, assetIndex: number) =>
    commit(
      scenes.map((scene, i) => {
        if (i !== index) return scene;
        const has = scene.assetIndexes.includes(assetIndex);
        return {
          ...scene,
          assetIndexes: has
            ? scene.assetIndexes.filter((entry) => entry !== assetIndex)
            : [...scene.assetIndexes, assetIndex],
        };
      })
    );

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const remove = (index: number) => commit(scenes.filter((_, i) => i !== index));

  const addScene = () =>
    commit([...scenes, { sceneNumber: scenes.length + 1, summary: "", assetIndexes: [] }]);

  const usable = scenes.filter((scene) => scene.assetIndexes.length > 0).length;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">Storyboard</h2>
        <p className="studio-panel-hint">
          A plan for the video, written from your brief and a small preview frame
          of each item. Your photos and clips stay on this phone.
        </p>

        {!canGenerate && (
          <p className="studio-note studio-note-warning">
            Add your material and fill in the place name and clip details first —
            there is nothing to plan from yet.
          </p>
        )}

        <button
          type="button"
          className="studio-button studio-button-ghost"
          style={{ marginTop: 12 }}
          disabled={disabled || generating || !canGenerate}
          onClick={onGenerate}
        >
          {generating
            ? "Planning…"
            : scenes.length > 0
              ? "Plan it again"
              : "Plan the storyboard"}
        </button>

        {error && (
          <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>

      {scenes.length > 0 && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">Scenes</h2>
          <p className="studio-panel-hint">
            Reorder them, rewrite what each one is about, and tap the material each
            one should use.
          </p>

          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {scenes.map((scene, index) => (
              <article key={index} className="studio-scene">
                <header className="studio-scene-head">
                  <h3 className="studio-scene-name">Scene {index + 1}</h3>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="studio-icon-button"
                      aria-label={`Move scene ${index + 1} earlier`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="studio-icon-button"
                      aria-label={`Move scene ${index + 1} later`}
                      disabled={disabled || index === scenes.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="studio-icon-button"
                      aria-label={`Remove scene ${index + 1}`}
                      style={{ color: "var(--s-danger)" }}
                      disabled={disabled}
                      onClick={() => remove(index)}
                    >
                      ×
                    </button>
                  </div>
                </header>

                <div style={{ padding: 12 }}>
                  <label>
                    <span className="studio-label">What this scene shows</span>
                    <textarea
                      className="studio-textarea"
                      style={{ minHeight: 72 }}
                      value={scene.summary}
                      disabled={disabled}
                      onChange={(event) => setSummary(index, event.target.value)}
                    />
                  </label>

                  <span className="studio-label" style={{ marginTop: 12 }}>
                    Material in this scene
                  </span>
                  <ul className="studio-pick-grid">
                    {sources.map((source, assetIndex) => {
                      const chosen = scene.assetIndexes.includes(assetIndex);
                      return (
                        <li key={source.id}>
                          <button
                            type="button"
                            className="studio-pick"
                            aria-pressed={chosen}
                            aria-label={`${chosen ? "Remove" : "Use"} ${source.fileName} in scene ${index + 1}`}
                            disabled={disabled}
                            onClick={() => toggleAsset(index, assetIndex)}
                          >
                            <MediaThumb source={source} />
                            {chosen && (
                              <span className="studio-pick-tick" aria-hidden>
                                ✓
                              </span>
                            )}
                            <span className="studio-pick-kind" aria-hidden>
                              {source.kind === "clip" ? "Clip" : "Photo"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {scene.assetIndexes.length === 0 && (
                    <p className="studio-shot-meta" style={{ marginTop: 8 }}>
                      Nothing chosen, so this scene will be dropped when the plan is
                      applied.
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>

          <button
            type="button"
            className="studio-button studio-button-ghost"
            style={{ marginTop: 12 }}
            disabled={disabled}
            onClick={addScene}
          >
            Add a scene
          </button>

          <button
            type="button"
            className="studio-button studio-button-primary"
            style={{ marginTop: 10 }}
            disabled={disabled || usable === 0}
            onClick={onApply}
          >
            Use this storyboard
          </button>
          <p className="studio-counter" style={{ textAlign: "left" }}>
            Replaces the timeline with {usable} scene{usable === 1 ? "" : "s"} and
            shares the video length out between their shots.
          </p>
        </section>
      )}

      {plan?.script && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">Suggested speaking script</h2>
          <p className="studio-panel-hint">
            For reference while you edit. The narration a request actually ships
            with is the approved voice, recorded and converted on the server.
          </p>
          <p className="studio-script">{plan.script}</p>
          {plan.caption && (
            <>
              <span className="studio-label" style={{ marginTop: 14 }}>
                Suggested caption
              </span>
              <p className="studio-script">{plan.caption}</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
