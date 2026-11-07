import {
  decideLabAccess,
  isSafeLabMediaName,
  type LabAccessInput,
} from "@/lib/lab/labAccess";

const LAB = "lab.tester@example.com";
const TOKEN = "t".repeat(64);
const REQUESTER = "requester";

type Overrides = Partial<Omit<LabAccessInput, "env">> & { env?: Record<string, string | undefined> };

/** Full valid config, with per-test overrides merged key by key (not replaced). */
function input(over: Overrides = {}): LabAccessInput {
  const { env: envOver, ...rest } = over;
  return {
    authorizationHeader: null,
    session: null,
    requesterRole: REQUESTER,
    ...rest,
    env: {
      LAB_AUTORUN_ENABLED: "true",
      LAB_RUNNER_TOKEN: TOKEN,
      DEVICE_RENDER_LAB_TEST_EMAIL: LAB,
      ...(envOver ?? {}),
    },
  };
}

const labSession = { user: { role: REQUESTER, email: LAB } };

describe("decideLabAccess: flag", () => {
  it("refuses everything when the flag is off, even with the right token", () => {
    const d = decideLabAccess(input({ env: { LAB_AUTORUN_ENABLED: "false" }, authorizationHeader: `Bearer ${TOKEN}` }));
    expect(d).toMatchObject({ ok: false, status: 404 });
  });
  it("refuses a lab session when the flag is off", () => {
    expect(decideLabAccess(input({ env: { LAB_AUTORUN_ENABLED: undefined }, session: labSession }))).toMatchObject({ ok: false, status: 404 });
  });
  it("treats any value other than exactly 'true' as off", () => {
    expect(decideLabAccess(input({ env: { LAB_AUTORUN_ENABLED: "TRUE" }, authorizationHeader: `Bearer ${TOKEN}` })).ok).toBe(false);
    expect(decideLabAccess(input({ env: { LAB_AUTORUN_ENABLED: "1" }, session: labSession })).ok).toBe(false);
  });
});

describe("decideLabAccess: runner token", () => {
  it("accepts the exact token", () => {
    expect(decideLabAccess(input({ authorizationHeader: `Bearer ${TOKEN}` }))).toEqual({ ok: true, via: "runner-token" });
  });
  it("refuses a wrong token", () => {
    expect(decideLabAccess(input({ authorizationHeader: `Bearer ${"x".repeat(64)}` }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses a token of a different length", () => {
    expect(decideLabAccess(input({ authorizationHeader: `Bearer ${TOKEN}0` }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses an empty bearer", () => {
    expect(decideLabAccess(input({ authorizationHeader: "Bearer " }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses a wrong bearer even when a lab session is present", () => {
    expect(decideLabAccess(input({ authorizationHeader: "Bearer nope", session: labSession }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses any token when LAB_RUNNER_TOKEN is unset", () => {
    expect(decideLabAccess(input({ env: { LAB_RUNNER_TOKEN: undefined }, authorizationHeader: "Bearer " + TOKEN }))).toMatchObject({ ok: false, status: 401 });
  });
  it("does not accept a non-Bearer scheme", () => {
    expect(decideLabAccess(input({ authorizationHeader: `Basic ${TOKEN}` }))).toMatchObject({ ok: false, status: 401 });
  });
});

describe("decideLabAccess: lab session", () => {
  it("accepts the exact lab account, Requester role", () => {
    expect(decideLabAccess(input({ session: labSession }))).toEqual({ ok: true, via: "lab-session" });
  });
  it("matches the email case-insensitively and ignores spaces", () => {
    expect(decideLabAccess(input({ session: { user: { role: REQUESTER, email: "  Lab.Tester@Example.com " } } })).ok).toBe(true);
  });
  it("refuses a different account, even a Requester", () => {
    expect(decideLabAccess(input({ session: { user: { role: REQUESTER, email: "pillarth@gmail.com" } } }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses the lab email with a non-Requester role", () => {
    expect(decideLabAccess(input({ session: { user: { role: "admin", email: LAB } } }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses when there is no session", () => {
    expect(decideLabAccess(input({ session: null }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses when the session has no email", () => {
    expect(decideLabAccess(input({ session: { user: { role: REQUESTER } } }))).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses everything when the lab email is not configured", () => {
    expect(decideLabAccess(input({ env: { DEVICE_RENDER_LAB_TEST_EMAIL: undefined }, session: labSession }))).toMatchObject({ ok: false, status: 401 });
    expect(decideLabAccess(input({ env: { DEVICE_RENDER_LAB_TEST_EMAIL: "" }, session: { user: { role: REQUESTER, email: "" } } }))).toMatchObject({ ok: false, status: 401 });
  });
});

describe("isSafeLabMediaName", () => {
  it.each(["VID20261004190226.mp4", "clip.MOV", "a b.m4v"])("allows %s", (name) => {
    expect(isSafeLabMediaName(name)).toBe(true);
  });
  it.each([
    "../secret.mp4",
    "..\\secret.mp4",
    "sub/clip.mp4",
    "sub\\clip.mp4",
    "a..b.mp4",
    "clip.exe",
    "clip",
    ".hidden.mp4",
    "",
    " clip.mp4",
    "clip.mp4\0.txt",
    "x".repeat(260) + ".mp4",
  ])("refuses %j", (name) => {
    expect(isSafeLabMediaName(name)).toBe(false);
  });
});
