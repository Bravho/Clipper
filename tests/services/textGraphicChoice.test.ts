/**
 * The text-graphics choice survives a database without migration 038: it is
 * also kept in render_payload, and either source is read.
 */
jest.mock("@/repositories/index", () => ({
  videoGenerationJobRepository: {},
  clipRequestRepository: {},
}));
import { textGraphicChoiceOf } from "@/services/TextGraphicsService";

describe("textGraphicChoiceOf", () => {
  it("reads render_payload when the column is missing (repository says 'none')", () => {
    expect(textGraphicChoiceOf({ selectedTextStyle: "none", renderPayload: { textStyle: "note" } })).toBe("note");
  });
  it("reads the column when render_payload has no choice", () => {
    expect(textGraphicChoiceOf({ selectedTextStyle: "auto", renderPayload: { localMedia: [] } })).toBe("auto");
  });
  it("is none when neither holds a real choice", () => {
    expect(textGraphicChoiceOf({ selectedTextStyle: null, renderPayload: { textStyle: "bogus" } })).toBe("none");
  });
});
