import { decideLabScreen } from "@/lib/lab/labScreen";

const LAB = "lab.tester@example.com";
const base = {
  flagValue: "true",
  providerExecutionEnabled: true,
  labEmail: LAB,
  requesterRole: "requester",
  session: { user: { id: "lab-1", role: "requester", email: LAB } },
};

describe("decideLabScreen", () => {
  it("shows only for the lab account with every gate on", () => {
    expect(decideLabScreen(base)).toEqual({ show: true });
  });
  it("hidden while provider execution is disabled in code, even for the lab account", () => {
    expect(decideLabScreen({ ...base, providerExecutionEnabled: false })).toEqual({ show: false });
  });
  it("hidden when the flag is off", () => {
    expect(decideLabScreen({ ...base, flagValue: undefined })).toEqual({ show: false });
  });
  it("hidden for another account, a signed-out visitor, or a wrong role", () => {
    expect(decideLabScreen({ ...base, session: { user: { id: "x", role: "requester", email: "other@x.com" } } })).toEqual({ show: false });
    expect(decideLabScreen({ ...base, session: null })).toEqual({ show: false });
    expect(decideLabScreen({ ...base, session: { user: { id: "lab-1", role: "admin", email: LAB } } })).toEqual({ show: false });
  });
});
