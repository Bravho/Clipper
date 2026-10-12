import { shotBoxesFromAnswer } from "@/lib/ai/shotFramingAi";

describe("shotBoxesFromAnswer", () => {
  // Shot 0 has frames 1–3 (a clip), shot 1 has frame 4 (a photo), shot 2 frame 5.
  const owner = [0, 0, 0, 1, 2];

  it("unions a clip's frames so a moving dish stays in view", () => {
    const boxes = shotBoxesFromAnswer(
      {
        frames: [
          { frame: 1, subject: [500, 100, 700, 400] },
          { frame: 2, subject: [550, 300, 750, 600] },
          { frame: 3, subject: [600, 500, 800, 800], keep: [400, 450, 900, 900] },
          { frame: 4, subject: [0, 0, 500, 500] },
        ],
      },
      owner,
      3
    );
    expect(boxes[0]?.subject).toEqual({ x0: 0.1, y0: 0.5, x1: 0.8, y1: 0.8 });
    expect(boxes[0]?.keep).toEqual({ x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.9 });
    expect(boxes[1]?.subject).toEqual({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
    expect(boxes[2]).toBeNull();
  });

  it("matches by label, so a skipped frame never shifts boxes onto the wrong shot", () => {
    const boxes = shotBoxesFromAnswer(
      { frames: [{ frame: 5, subject: [100, 100, 200, 200] }] },
      owner,
      3
    );
    expect(boxes[0]).toBeNull();
    expect(boxes[1]).toBeNull();
    expect(boxes[2]?.subject).toEqual({ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 });
  });

  it("ignores junk", () => {
    expect(
      shotBoxesFromAnswer({ frames: [{ frame: 9, subject: [1, 2, 3, 4] }, { frame: 1 }, null, "x"] }, owner, 3)
    ).toEqual([null, null, null]);
    expect(shotBoxesFromAnswer(null, owner, 3)).toEqual([null, null, null]);
  });
});
