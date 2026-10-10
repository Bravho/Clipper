import { TEXT_GRAPHIC_STYLES, TEXT_GRAPHIC_STYLE_IDS } from "@/config/textGraphicStyles";
import { layoutTextGraphicItem, safeTop, type TgItemLayout } from "@/lib/textGraphics/layout";
import { sanitizeTextGraphicItems } from "@/lib/textGraphics/plan";

/**
 * layout.ts is the reference the phone renderers are ported from. These pin
 * where items land, so a port that drifts is caught here first.
 */
const measure = (text: string, _font: string, size: number) => text.length * size * 0.55;
const metrics = () => ({ ascent: 1, descent: 0.3 });
const W = 1080;
const H = 1920;

function label(position = "") {
  return sanitizeTextGraphicItems(
    [{ kind: "label", start: 1, end: 4, title: "ข้าวมันไก่", sub: "Chicken Rice", badge: "แนะนำ!", position }],
    10
  )[0];
}

function lay(styleId: (typeof TEXT_GRAPHIC_STYLE_IDS)[number], position = ""): TgItemLayout {
  return layoutTextGraphicItem({
    item: label(position),
    style: TEXT_GRAPHIC_STYLES[styleId],
    accent: "#D7262E",
    width: W,
    height: H,
    measure,
    metrics,
  });
}

describe("text-graphics layout", () => {
  it("puts each pack's label at its own default position", () => {
    expect(lay("premium").position).toBe("top-left");
    expect(lay("street").position).toBe("top-right");
    expect(lay("cafe").position).toBe("middle-left");
    expect(lay("magazine").position).toBe("top-right");
    expect(lay("slash").position).toBe("middle-right");
  });

  it("lets the plan move a label, and keeps it inside the frame margins", () => {
    for (const position of ["top-left", "top-center", "top-right", "middle-left", "middle-right"]) {
      const l = lay("premium", position);
      expect(l.position).toBe(position);
      expect(l.x).toBeGreaterThanOrEqual(64 - 1e-6);
      expect(l.x + l.w).toBeLessThanOrEqual(W - 64 + 1e-6);
      expect(l.y).toBeGreaterThanOrEqual(safeTop(W, H) - 1e-6);
    }
    const right = lay("premium", "top-right");
    expect(right.x + right.w).toBeCloseTo(W - 64, 6);
    expect(right.pivotX).toBeCloseTo(W - 64, 6);
  });

  it("keeps captions' bottom band clear", () => {
    for (const id of TEXT_GRAPHIC_STYLE_IDS) {
      const l = lay(id, "middle-right");
      expect(l.y + l.h).toBeLessThan(H - 150 - 200);
    }
  });

  it("frames add their own padding around the words", () => {
    const card = lay("premium").nodes.find((n) => n.id === "card")!;
    const slant = lay("slash").nodes.find((n) => n.id === "card")!;
    const slantTitle = slant.children.find((n) => n.id === "title")!;
    // The slant's lean is added to the card padding, so the words clear the sloped edge.
    expect(slantTitle.x - slant.x).toBeGreaterThanOrEqual(26 + 34 - 1e-6);
    const frameless = lay("minimal").nodes.find((n) => n.id === "card")!;
    const framelessTitle = frameless.children.find((n) => n.id === "title")!;
    expect(framelessTitle.x).toBe(frameless.x);
    expect(card.paint.type).toBe("panel");
  });

  it("keeps a frameless badge clear of the words", () => {
    const l = lay("minimal");
    const card = l.nodes.find((n) => n.id === "card")!;
    const badge = l.nodes.find((n) => n.id === "badge")!;
    expect(badge.x).toBeGreaterThan(card.x + card.w);
  });

  it("gives frameless packs a text effect so the words stay readable", () => {
    for (const id of ["minimal", "neon", "magazine"] as const) {
      const title = lay(id).nodes.find((n) => n.id === "card")!.children.find((n) => n.id === "title")!;
      expect(title.paint.type === "text" && title.paint.effect.kind).not.toBe("plain");
    }
  });
});
