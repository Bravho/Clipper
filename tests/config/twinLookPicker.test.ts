import { autoPickLook, getLookOrientation, ratioOrientation } from "@/config/twinLookPicker";

const L = [
  { id: "land", groupId: "g1", imageWidth: 1280, imageHeight: 720, status: "completed", selectable: true },
  { id: "port", groupId: "g1", imageWidth: 1080, imageHeight: 1920, status: "completed", selectable: true },
  { id: "train", groupId: "g2", preferredOrientation: "portrait" as const, status: "processing", selectable: false },
  { id: "other", groupId: "g2", imageWidth: 1920, imageHeight: 1080, status: "completed", selectable: true },
];

describe("twinLookPicker", () => {
  it("derives orientation", () => {
    expect(getLookOrientation(L[0])).toBe("landscape");
    expect(getLookOrientation(L[1])).toBe("portrait");
    expect(getLookOrientation({ id: "s", imageWidth: 5, imageHeight: 5 })).toBe("square");
    expect(getLookOrientation({ id: "x" })).toBeUndefined();
  });
  it("maps ratios to orientation", () => {
    expect(ratioOrientation("9:16")).toBe("portrait");
    expect(ratioOrientation("4:5")).toBe("portrait");
    expect(ratioOrientation("16:9")).toBe("landscape");
    for (const r of ["1:1", "5:4", "auto"] as const) expect(ratioOrientation(r)).toBeUndefined();
  });
  it("picks portrait for 9:16/4:5 and landscape for 16:9 within the group", () => {
    expect(autoPickLook(L, "g1", "9:16")).toBe("port");
    expect(autoPickLook(L, "g1", "4:5")).toBe("port");
    expect(autoPickLook(L, "g1", "16:9")).toBe("land");
  });
  it("keeps current choice (undefined) for 1:1, 5:4, auto", () => {
    for (const r of ["1:1", "5:4", "auto"] as const) expect(autoPickLook(L, "g1", r)).toBeUndefined();
  });
  it("never picks a training look or one from another group", () => {
    expect(autoPickLook(L, "g2", "9:16")).toBeUndefined();
    expect(autoPickLook(L, "g2", "16:9")).toBe("other");
    expect(autoPickLook(L, undefined, "9:16")).toBeUndefined();
  });
  it("respects a manual override per group+ratio, including on 1:1", () => {
    expect(autoPickLook(L, "g1", "9:16", { "g1:9:16": "land" })).toBe("land");
    expect(autoPickLook(L, "g1", "1:1", { "g1:1:1": "port" })).toBe("port");
    // stale override (not selectable / other group) falls back to orientation rule
    expect(autoPickLook(L, "g1", "9:16", { "g1:9:16": "other" })).toBe("port");
  });
});