import { generateKeyPair, SignJWT, exportJWK, type JWK } from "jose";

/**
 * The display-name hand-off for Sign in with Apple on **Android**.
 *
 * Apple sends the user's name exactly once, as a `user` form field on the
 * callback, and the Capacitor plugin discards it — so the callback route parks
 * it and `verifyAppleIdToken` collects it a moment later. If this breaks, every
 * Android Apple signup is silently created with the email address as its display
 * name, and Apple will not send the name a second time.
 *
 * As in appleIdToken.test.ts, `createRemoteJWKSet` is mocked to a locally
 * generated key so the real signature path runs without touching the network.
 */

let testJwk: JWK;

jest.mock("jose", () => {
  const actual = jest.requireActual("jose");
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet({ keys: [testJwk] }),
  };
});

const SERVICES_ID = "com.rclipper.app.web";
const BUNDLE_ID = "com.rclipper.app";
const SUB = "001234.apple.sub";

let privateKey: CryptoKey;

async function makeToken(sub: string = SUB): Promise<string> {
  return new SignJWT({
    email: "joe@privaterelay.appleid.com",
    email_verified: "true",
  })
    .setProtectedHeader({ alg: "RS256", kid: testJwk.kid })
    .setIssuer("https://appleid.apple.com")
    // Android runs the OAuth flow as a plain web client, so `aud` is the
    // Services ID rather than the bundle ID iOS uses.
    .setAudience(SERVICES_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

type Memo = typeof import("@/lib/auth/appleNameMemo");
type Verifier = typeof import("@/lib/auth/appleIdToken");

let rememberAppleName: Memo["rememberAppleName"];
let takeAppleName: Memo["takeAppleName"];
let clearAppleNameMemo: Memo["clearAppleNameMemo"];
let verifyAppleIdToken: Verifier["verifyAppleIdToken"];

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  testJwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "apple-test-key",
    alg: "RS256",
  };
  ({ rememberAppleName, takeAppleName, clearAppleNameMemo } = await import(
    "@/lib/auth/appleNameMemo"
  ));
  ({ verifyAppleIdToken } = await import("@/lib/auth/appleIdToken"));
});

beforeEach(() => {
  process.env.APPLE_CLIENT_ID = SERVICES_ID;
  process.env.APPLE_NATIVE_CLIENT_ID = BUNDLE_ID;
  clearAppleNameMemo();
});

describe("appleNameMemo", () => {
  it("hands back the name parked for a sub", () => {
    rememberAppleName(SUB, "Joe Example");
    expect(takeAppleName(SUB)).toBe("Joe Example");
  });

  it("consumes the entry, so a replay gets nothing", () => {
    rememberAppleName(SUB, "Joe Example");
    takeAppleName(SUB);
    expect(takeAppleName(SUB)).toBeUndefined();
  });

  it("does not confuse one user's name with another's", () => {
    rememberAppleName(SUB, "Joe Example");
    expect(takeAppleName("000999.other.sub")).toBeUndefined();
  });

  it("ignores a blank name rather than storing an empty one", () => {
    rememberAppleName(SUB, "   ");
    expect(takeAppleName(SUB)).toBeUndefined();
  });

  it("strips control characters and caps the length", () => {
    rememberAppleName(SUB, `Joe\nExample${"x".repeat(300)}`);
    const name = takeAppleName(SUB) ?? "";
    expect(name).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(name.length).toBeLessThanOrEqual(120);
  });
});

describe("verifyAppleIdToken with the Android name hand-off", () => {
  it("uses the parked name when the client has none to forward", async () => {
    rememberAppleName(SUB, "Joe Example");

    const identity = await verifyAppleIdToken(await makeToken());

    expect(identity).toEqual({
      providerAccountId: SUB,
      email: "joe@privaterelay.appleid.com",
      name: "Joe Example",
    });
  });

  it("still falls back to the email when nothing was parked", async () => {
    const identity = await verifyAppleIdToken(await makeToken());
    expect(identity.name).toBe("joe@privaterelay.appleid.com");
  });

  it("prefers the client-supplied name, leaving the memo untouched", async () => {
    // The iOS path: the native sheet gives the client a name, so the memo — if
    // one somehow exists for this sub — must not override it.
    rememberAppleName(SUB, "Stale Memo");

    const identity = await verifyAppleIdToken(await makeToken(), "Joe From iOS");

    expect(identity.name).toBe("Joe From iOS");
    expect(takeAppleName(SUB)).toBe("Stale Memo");
  });

  it("does not let a parked name decide which account is used", async () => {
    // The name is cosmetic; identity comes from the verified `sub` alone.
    rememberAppleName("000999.other.sub", "Someone Else");

    const identity = await verifyAppleIdToken(await makeToken());

    expect(identity.providerAccountId).toBe(SUB);
    expect(identity.name).toBe("joe@privaterelay.appleid.com");
  });
});
