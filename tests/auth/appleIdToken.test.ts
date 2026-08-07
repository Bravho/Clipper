import { generateKeyPair, SignJWT, exportJWK, type JWK } from "jose";

/**
 * Unit tests for the native-iOS Apple identity-token verifier.
 *
 * As in googleIdToken.test.ts, `createRemoteJWKSet` is mocked to a locally
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

let privateKey: CryptoKey;

async function makeToken(
  claims: Record<string, unknown> = {},
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {}
): Promise<string> {
  return new SignJWT({
    email: "joe@privaterelay.appleid.com",
    email_verified: "true", // Apple sends this as a *string* for some clients
    is_private_email: "true",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: testJwk.kid })
    .setIssuer(overrides.issuer ?? "https://appleid.apple.com")
    .setAudience(overrides.audience ?? BUNDLE_ID)
    .setSubject((claims.sub as string) ?? "001234.apple.sub")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
}

type Verifier = typeof import("@/lib/auth/appleIdToken");
let verifyAppleIdToken: Verifier["verifyAppleIdToken"];

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  testJwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "apple-test-key",
    alg: "RS256",
  };
  ({ verifyAppleIdToken } = await import("@/lib/auth/appleIdToken"));
});

beforeEach(() => {
  process.env.APPLE_CLIENT_ID = SERVICES_ID;
  process.env.APPLE_NATIVE_CLIENT_ID = BUNDLE_ID;
});

describe("verifyAppleIdToken", () => {
  it("accepts a native token issued for the bundle ID", async () => {
    await expect(verifyAppleIdToken(await makeToken())).resolves.toEqual({
      providerAccountId: "001234.apple.sub",
      email: "joe@privaterelay.appleid.com",
      // Apple puts no name in the token, so it falls back to the email.
      name: "joe@privaterelay.appleid.com",
    });
  });

  it("accepts a web token issued for the Services ID", async () => {
    const token = await makeToken({}, { audience: SERVICES_ID });
    await expect(verifyAppleIdToken(token)).resolves.toMatchObject({
      providerAccountId: "001234.apple.sub",
    });
  });

  it("uses the client-supplied name Apple only sends on first authorization", async () => {
    const identity = await verifyAppleIdToken(await makeToken(), "Joe Example");
    expect(identity.name).toBe("Joe Example");
  });

  it("strips control characters and caps the client-supplied name", async () => {
    const identity = await verifyAppleIdToken(
      await makeToken(),
      `Joe\nExample${"x".repeat(300)}`
    );
    expect(identity.name).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(identity.name.length).toBeLessThanOrEqual(120);
  });

  it("rejects a token minted for another app", async () => {
    const token = await makeToken({}, { audience: "com.someone.else" });
    await expect(verifyAppleIdToken(token)).rejects.toThrow(
      "apple:IdTokenInvalid"
    );
  });

  it("rejects a non-Apple issuer", async () => {
    const token = await makeToken({}, { issuer: "https://evil.example.com" });
    await expect(verifyAppleIdToken(token)).rejects.toThrow(
      "apple:IdTokenInvalid"
    );
  });

  it("rejects an expired token", async () => {
    const token = await makeToken({}, { expiresIn: "-5m" });
    await expect(verifyAppleIdToken(token)).rejects.toThrow(
      "apple:IdTokenInvalid"
    );
  });

  it("rejects an unverified email", async () => {
    const token = await makeToken({ email_verified: "false" });
    await expect(verifyAppleIdToken(token)).rejects.toThrow(
      "apple:EmailNotVerified"
    );
  });

  it("fails closed when no audience is configured", async () => {
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_NATIVE_CLIENT_ID;
    await expect(verifyAppleIdToken(await makeToken())).rejects.toThrow(
      "apple:AudienceNotConfigured"
    );
  });

  it("rejects an empty token", async () => {
    await expect(verifyAppleIdToken("")).rejects.toThrow("apple:IdTokenMissing");
  });
});
