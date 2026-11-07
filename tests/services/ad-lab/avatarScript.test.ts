import {
  avatarKeyPrefix,
  buildSpokenText,
  isOwnAvatarKey,
  scriptHash,
} from "@/services/ad-lab/avatarScript";
import { applySpokenTextEdit, isLegacyAvatarSplitEdit } from "@/services/ad-lab/spokenText";
import type { AdLabScriptDraft } from "@/domain/models/AdLab";

const BASE_DRAFT: AdLabScriptDraft = {
  id: "draft-1",
  brandId: "brand-1",
  title: "Test Draft",
  mainMessage: "",
  detailedContent: "",
  presentationDirection: "",
  objective: "conversion",
  duration: "30",
  mainHook: "เปิด hook",
  hooks: "hook2",
  painPointsOrIntroduction: "intro",
  content: "เนื้อหา",
  solution: "solution",
  conversion: "CTA",
  closing: "จบ",
  channels: ["tiktok"],
  status: "approved",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// No network in tests: any accidental fetch throws.
beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
});

describe("buildSpokenText", () => {
  it("uses scriptPlan when present and non-empty (no mainHook)", () => {
    const draft = { ...BASE_DRAFT, mainHook: "", scriptPlan: "This is the canonical plan." };
    expect(buildSpokenText(draft)).toBe("This is the canonical plan.");
  });

  it("falls back to legacy body fields (without mainHook) when scriptPlan is absent", () => {
    const result = buildSpokenText(BASE_DRAFT);
    expect(result.startsWith("hook2")).toBe(true);
    expect(result).not.toContain(BASE_DRAFT.mainHook);
    expect(result).toContain("solution");
  });

  it("strips 【...】 headers from scriptPlan", () => {
    const draft = { ...BASE_DRAFT, scriptPlan: "【Hook】\nเปิดด้วยคำถาม\n【Body】\nเนื้อหาหลัก" };
    const result = buildSpokenText(draft);
    expect(result).not.toContain("【");
    expect(result).toContain("เปิดด้วยคำถาม");
    expect(result).toContain("เนื้อหาหลัก");
  });

  it("collapses multiple spaces within a line but keeps line breaks (no mainHook)", () => {
    const draft = { ...BASE_DRAFT, mainHook: "", scriptPlan: "word1   word2\nword3   word4" };
    const result = buildSpokenText(draft);
    expect(result).toBe("word1 word2\nword3 word4");
  });

  it("trims the result (no mainHook)", () => {
    const draft = { ...BASE_DRAFT, mainHook: "", scriptPlan: "  \n  hello  \n  " };
    expect(buildSpokenText(draft)).toBe("hello");
  });

  it("returns empty string when all legacy fields are empty", () => {
    const empty = { ...BASE_DRAFT, mainHook: "", hooks: "", painPointsOrIntroduction: "", content: "", solution: "", conversion: "", closing: "" };
    expect(buildSpokenText(empty)).toBe("");
  });

  it("speaks exactly the Create body: mainHook is NOT prepended for Create drafts", () => {
    const draft = { ...BASE_DRAFT, mainHook: "AI hook sentence", scriptPlan: "\u30101. Topic\u3011\nBody content here.", scriptPlanHtml: "<p>x</p>" };
    expect(buildSpokenText(draft)).toBe("Body content here.");
  });

  it("does not prepend mainHook for header-less bodies that have formatting HTML", () => {
    const draft = { ...BASE_DRAFT, mainHook: "AI hook", scriptPlan: "Line A\nLine B", scriptPlanHtml: "<p>Line A</p>" };
    expect(buildSpokenText(draft)).toBe("Line A\nLine B");
  });

  it("legacy avatar split edit: hook (user's first line) is spoken once, before the body", () => {
    const draft = { ...BASE_DRAFT, mainHook: "My first line", scriptPlan: "Line 2\nLine 3", scriptPlanHtml: undefined };
    expect(isLegacyAvatarSplitEdit(draft)).toBe(true);
    expect(buildSpokenText(draft)).toBe("My first line\nLine 2\nLine 3");
  });

  it("legacy split draft re-edited with the new editor: no duplicate hook", () => {
    const legacy = { ...BASE_DRAFT, mainHook: "My first line", scriptPlan: "Line 2", scriptPlanHtml: undefined };
    const edited = applySpokenTextEdit(legacy, buildSpokenText(legacy));
    expect(edited.mainHook).toBe("My first line");
    expect(edited.scriptPlan).toBe("My first line\nLine 2");
    expect(isLegacyAvatarSplitEdit(edited)).toBe(false);
    expect(buildSpokenText(edited)).toBe("My first line\nLine 2");
  });

  it("removing the hook line in the editor removes it from speech", () => {
    const legacy = { ...BASE_DRAFT, mainHook: "My first line", scriptPlan: "Line 2", scriptPlanHtml: undefined };
    const edited = applySpokenTextEdit(legacy, "Line 2");
    expect(buildSpokenText(edited)).toBe("Line 2");
  });

  it("changing the body changes scriptHash(buildSpokenText(draft))", () => {
    const draft1 = { ...BASE_DRAFT, scriptPlan: "\u3010A\u3011\nBody 1" };
    const draft2 = { ...BASE_DRAFT, scriptPlan: "\u3010A\u3011\nBody 2" };
    expect(scriptHash(buildSpokenText(draft1))).not.toBe(scriptHash(buildSpokenText(draft2)));
  });
});

describe("scriptHash", () => {
  it("returns a 64-char hex string", () => {
    expect(scriptHash("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(scriptHash("hello")).toBe(scriptHash("hello"));
  });

  it("differs for different inputs", () => {
    expect(scriptHash("hello")).not.toBe(scriptHash("world"));
  });
});

describe("avatarKeyPrefix", () => {
  it("follows the expected pattern", () => {
    expect(avatarKeyPrefix("user123", "draft456")).toBe("ad_lab/user123/avatar/draft456/");
  });
});

describe("applySpokenTextEdit", () => {
  const CANONICAL = { ...BASE_DRAFT, mainHook: "Hook", scriptPlan: "Body line 1\nBody line 2" };

  it("round-trip multi-line: buildSpokenText(result) === normalize(newText)", () => {
    const newText = "First line\nSecond line\nThird line";
    const result = applySpokenTextEdit(CANONICAL, newText);
    expect(buildSpokenText(result)).toBe("First line\nSecond line\nThird line");
  });

  it("round-trip single-line", () => {
    const result = applySpokenTextEdit(CANONICAL, "Only line");
    expect(buildSpokenText(result)).toBe("Only line");
  });

  it("strips 【...】 headers from newText during normalization", () => {
    const result = applySpokenTextEdit(CANONICAL, "【Hook】\nFirst\n【Body】\nSecond");
    expect(buildSpokenText(result)).toBe("First\nSecond");
  });

  it("collapses extra whitespace in newText", () => {
    const result = applySpokenTextEdit(CANONICAL, "word1   word2\nword3   word4");
    expect(buildSpokenText(result)).toBe("word1 word2\nword3 word4");
  });

  it("preserves draft status (approved stays approved)", () => {
    const result = applySpokenTextEdit({ ...CANONICAL, status: "approved" }, "new text");
    expect(result.status).toBe("approved");
  });

  it("preserves existing avatar (staleness detected via hash comparison, not deletion)", () => {
    const avatar = { scriptHash: "old-hash", updatedAt: "2026-01-01T00:00:00.000Z" };
    const result = applySpokenTextEdit({ ...CANONICAL, avatar }, "new text");
    expect(result.avatar).toEqual(avatar);
  });

  it("rebuilds scriptPlanHtml as escaped plain lines for the Create editor", () => {
    const result = applySpokenTextEdit({ ...CANONICAL, scriptPlanHtml: "<p>old</p>" }, "a <b>\nline 2");
    expect(result.scriptPlanHtml).toBe("<div>a &lt;b&gt;</div><div>line 2</div>");
  });

  it("an edited draft whose body no longer starts with the AI hook does not get the hook re-added", () => {
    const aiDraft = { ...BASE_DRAFT, mainHook: "AI hook", scriptPlan: "\u30101. T\u3011\nBody", scriptPlanHtml: "<div>x</div>" };
    const edited = applySpokenTextEdit(aiDraft, "Body edited");
    expect(isLegacyAvatarSplitEdit(edited)).toBe(false);
    expect(buildSpokenText(edited)).toBe("Body edited");
  });

  it("promotes legacy drafts (no scriptPlan) to canonical form", () => {
    const legacy = { ...BASE_DRAFT, scriptPlan: undefined };
    const result = applySpokenTextEdit(legacy, "Hook line\nBody line");
    expect(result.scriptPlan).toBeTruthy();
    expect(buildSpokenText(result)).toBe("Hook line\nBody line");
  });

  it("hash changes after edit (staleness would be detected by estimate)", () => {
    const original = { ...CANONICAL };
    const edited = applySpokenTextEdit(original, "Completely different text");
    expect(scriptHash(buildSpokenText(original))).not.toBe(
      scriptHash(buildSpokenText(edited))
    );
  });

  it("writes the whole text to scriptPlan and leaves mainHook untouched", () => {
    const result = applySpokenTextEdit(CANONICAL, "MyHook\nLine2\nLine3");
    expect(result.mainHook).toBe("Hook");
    expect(result.scriptPlan).toBe("MyHook\nLine2\nLine3");
  });
});

describe("isOwnAvatarKey", () => {
  it("returns true for a key under the correct prefix", () => {
    expect(isOwnAvatarKey("u1", "d1", "ad_lab/u1/avatar/d1/voice-123.mp3")).toBe(true);
  });

  it("returns false for a key under a different user", () => {
    expect(isOwnAvatarKey("u1", "d1", "ad_lab/u2/avatar/d1/voice-123.mp3")).toBe(false);
  });

  it("returns false for a key under a different draft", () => {
    expect(isOwnAvatarKey("u1", "d1", "ad_lab/u1/avatar/d2/voice-123.mp3")).toBe(false);
  });

  it("returns false for an unrelated key", () => {
    expect(isOwnAvatarKey("u1", "d1", "voice_recordings/u1/d1/file.mp3")).toBe(false);
  });
});
