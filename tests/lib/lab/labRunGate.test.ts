import { decideLabRunGate, type LabRunGateInput } from "@/lib/lab/labRunGate";

const LAB = "lab.tester@example.com";
const LAB_USER = "user-lab-1";
const OTHER_USER = "user-other-2";

function base(over: Partial<LabRunGateInput> = {}): LabRunGateInput {
  return {
    flagValue: "true",
    labEmail: LAB,
    requesterRole: "requester",
    session: { user: { id: LAB_USER, role: "requester", email: LAB } },
    requestOwnerId: LAB_USER,
    ...over,
  };
}

describe("decideLabRunGate", () => {
  it("allows the lab account on its own request when the flag is on", () => {
    expect(decideLabRunGate(base())).toEqual({ ok: true });
  });

  it("refuses everything when the flag is off or not exactly 'true'", () => {
    for (const flagValue of [undefined, "", "false", "TRUE", "1"]) {
      expect(decideLabRunGate(base({ flagValue }))).toMatchObject({ ok: false, status: 404, reason: "flag_off" });
    }
  });

  it("refuses a signed-out caller", () => {
    expect(decideLabRunGate(base({ session: null }))).toMatchObject({ ok: false, status: 401, reason: "not_lab_account" });
  });

  it("refuses a non-lab account even when it owns the request", () => {
    const session = { user: { id: OTHER_USER, role: "requester", email: "pillarth@gmail.com" } };
    expect(decideLabRunGate(base({ session, requestOwnerId: OTHER_USER }))).toMatchObject({ ok: false, status: 401, reason: "not_lab_account" });
  });

  it("refuses the lab email with the wrong role", () => {
    const session = { user: { id: LAB_USER, role: "admin", email: LAB } };
    expect(decideLabRunGate(base({ session }))).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses when the lab email is not configured", () => {
    expect(decideLabRunGate(base({ labEmail: undefined }))).toMatchObject({ ok: false, status: 401 });
    expect(decideLabRunGate(base({ labEmail: "   " }))).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a lab session with no user id", () => {
    const session = { user: { id: null, role: "requester", email: LAB } };
    expect(decideLabRunGate(base({ session }))).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses another owner's request, without revealing it exists", () => {
    expect(decideLabRunGate(base({ requestOwnerId: OTHER_USER }))).toMatchObject({
      ok: false,
      status: 404,
      reason: "request_not_found_or_not_owned",
    });
  });

  it("refuses a request that does not exist", () => {
    expect(decideLabRunGate(base({ requestOwnerId: null }))).toMatchObject({
      ok: false,
      status: 404,
      reason: "request_not_found_or_not_owned",
    });
  });

  it("matches the email case-insensitively", () => {
    const session = { user: { id: LAB_USER, role: "requester", email: "LAB.Tester@Example.com" } };
    expect(decideLabRunGate(base({ session }))).toEqual({ ok: true });
  });
});
