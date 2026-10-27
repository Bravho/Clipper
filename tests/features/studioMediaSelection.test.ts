/**
 * Ordered media selection (Tho, 2026-10-26): tapping a Media tile numbers it
 * 1, 2, 3…; tapping a numbered tile unselects it and renumbers the rest. Only
 * the selected items are submitted, in that order, and the storyboard is one
 * scene per selected item in that order.
 */
import {
  autoArrange,
  emptyDocument,
  restoreSelection,
  selectedSources,
  submissionProblems,
  toggleSelection,
  type EditorSource,
} from "@/features/device-render/editorState";

const source = (id: string, kind: "image" | "clip" = "image"): EditorSource => ({
  id,
  kind,
  file: new File([new Uint8Array(10)], `${id}.${kind === "clip" ? "mp4" : "jpg"}`, {
    type: kind === "clip" ? "video/mp4" : "image/jpeg",
  }),
  previewUrl: `blob:${id}`,
  posterUrl: null,
  durationSeconds: kind === "clip" ? 6 : null,
  fileName: `${id}.${kind === "clip" ? "mp4" : "jpg"}`,
});

describe("ordered media selection", () => {
  it("starts with nothing selected", () => {
    expect(emptyDocument().selection).toEqual([]);
  });

  it("numbers taps in order and renumbers after an unselect", () => {
    let selection: string[] = [];
    selection = toggleSelection(selection, "c"); // 1
    selection = toggleSelection(selection, "a"); // 2
    selection = toggleSelection(selection, "b"); // 3
    expect(selection).toEqual(["c", "a", "b"]);
    selection = toggleSelection(selection, "a"); // unselect #2 → b becomes #2
    expect(selection).toEqual(["c", "b"]);
    selection = toggleSelection(selection, "a"); // reselect → last
    expect(selection).toEqual(["c", "b", "a"]);
  });

  it("gives the selected sources in selection order, skipping unselected and missing ids", () => {
    const sources = [source("a"), source("b", "clip"), source("c")];
    expect(
      selectedSources({ sources, selection: ["c", "gone", "a", "c"] }).map((s) => s.id)
    ).toEqual(["c", "a"]);
  });

  it("builds the storyboard as one scene per selected item, in order", () => {
    const sources = [source("a"), source("b", "clip"), source("c")];
    const scenes = autoArrange(selectedSources({ sources, selection: ["b", "c"] }));
    expect(scenes.map((scene) => scene.shots.map((shot) => shot.sourceId))).toEqual([["b"], ["c"]]);
  });

  it("restores a saved order, or selects everything for an older draft", () => {
    const sources = [source("a"), source("b"), source("c")];
    expect(restoreSelection(sources, ["c", "x", "a"])).toEqual(["c", "a"]);
    expect(restoreSelection(sources, null)).toEqual(["a", "b", "c"]);
  });

  it("asks for a selection when nothing is selected", () => {
    const sources = [source("a")];
    expect(submissionProblems(selectedSources({ sources, selection: [] }))).toHaveLength(1);
    expect(submissionProblems(selectedSources({ sources, selection: ["a"] }))).toEqual([]);
  });
});
