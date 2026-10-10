import { easeBack, enterState, exitState, idleState } from "@/lib/textGraphics/motion";

/**
 * motion.ts is the reference the Android painter and the iOS layers are
 * ported from. These pin the values those ports must reproduce.
 */
describe("text-graphics motion", () => {
  it("hides a part until its delay has passed", () => {
    expect(enterState({ kind: "rise", delay: 0.2, dur: 0.4 }, 0.1).visible).toBe(false);
    expect(enterState({ kind: "rise", delay: 0.2, dur: 0.4 }, 0.3).visible).toBe(true);
  });

  it("settles every enter kind at rest", () => {
    for (const kind of ["rise", "wipe", "pop", "fade", "growX", "growY", "drop"] as const) {
      const st = enterState({ kind, delay: 0, dur: 0.5 }, 1);
      expect(st).toMatchObject({ scaleX: 1, scaleY: 1, alpha: 1, clipRight: 1 });
      expect(st.translateY).toBeCloseTo(0, 9);
      expect(st.riseFraction).toBeCloseTo(0, 9);
    }
  });

  it("overshoots on pop", () => {
    expect(easeBack(0.7)).toBeGreaterThan(1);
    expect(easeBack(1)).toBeCloseTo(1, 9);
    expect(easeBack(0)).toBeCloseTo(0, 9);
  });

  it("starts the idle loop after the enter, continuously", () => {
    const anim = { kind: "pop" as const, delay: 0.55, dur: 0.45 };
    const idle = { kind: "wobble" as const, amp: 4, period: 1.4 };
    expect(idleState(idle, anim, 0.9).rotateDeg).toBe(0);
    expect(idleState(idle, anim, 1.0).rotateDeg).toBeCloseTo(0, 9);
    expect(idleState(idle, anim, 1.35).rotateDeg).toBeCloseTo(4, 6);
  });

  it("exits over the last seconds only", () => {
    const exit = { kind: "slideLeft" as const, dur: 0.35 };
    expect(exitState(exit, 5, 10)).toMatchObject({ scale: 1, alpha: 1 });
    const end = exitState(exit, 10, 10);
    expect(end.alpha).toBeCloseTo(0, 9);
    expect(end.translateX).toBeCloseTo(-40, 9);
  });
});
