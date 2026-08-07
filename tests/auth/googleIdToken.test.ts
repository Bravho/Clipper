import { generateKeyPair, SignJWT, exportJWK, type JWK } from "jose";

/**
 * Unit tests for the native-Android Google ID token verifier.
 *
 * The verifier normally fetches Google's JWKS over the network. Here we mock
 * `createRemoteJWKSet` to return a locally generated key so the signature path
 * is exercised for real (no stubbed-out crypto) without touching the network.
 */

let testJwk: JWK;

jest.mock("jose", () => {
  const actual = jest.requireActual("jose");
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet({ keys: [testJwk] }),
  };
});

const WEB_CLIENT_ID = "123-web.apps.googleusercontent.com";

let privateKey: CryptoKey;

async function makeToken(
  claims: Record<string, unknown> = {},
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {}
): Promise<string> {
  return new SignJWT({
    email: "joe@example.com",
    email_verified: true,
    name: "Joe Example",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: testJwk.kid })
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? WEB_CLIENT_ID)
    .setSubject((claims.sub as string) ?? "google-sub-1")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
}

// Imported lazily so the jose mock (and testJwk) are in place first.
type Verifier = typeof import("@/lib/auth/googleIdToken");
let verifyGoogleIdToken: Verifier["verifyGoogleIdToken"];

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  testJwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "RS256" };
  ({ verifyGoogleIdToken } = await import("@/lib/auth/googleIdToken"));
});

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = WEB_CLIENT_ID;
  delete process.env.GOOGLE_ANDROID_CLIENT_ID;
  delete process.env.GOOGLE_IOS_CLIENT_ID;
});

describe("verifyGoogleIdToken", () => {
  it("returns the identity for a valid token", async () => {
    const identity = await verifyGoogleIdToken(await makeToken());

    expect(identity).toEqual({
      providerAccountId: "google-sub-1",
      email: "joe@example.com",
      name: "Joe Example",
    });
  });

  it("accepts the legacy bare issuer Google still uses", async () => {
    const token = await makeToken({}, { issuer: "accounts.google.com" });
    await expect(verifyGoogleIdToken(token)).resolves.toMatchObject({
      providerAccountId: "google-sub-1",
    });
  });

  it("accepts a dedicated Android client ID when configured", async () => {
    process.env.GOOGLE_ANDROID_CLIENT_ID = "123-android.apps.googleusercontent.com";
    const token = await makeToken(
      {},
      { audience: "123-android.apps.googleusercontent.com" }
    );

    await expect(verifyGoogleIdToken(token)).resolves.toMatchObject({
      email: "joe@example.com",
    });
  });

  it("rejects a token minted for a different client ID", async () => {
    const token = await makeToken({}, { audience: "someone-elses-app" });
    await expect(verifyGoogleIdToken(token)).rejects.toThrow(
      "google:IdTokenInvalid"
    );
  });

  it("rejects a token from a non-Google issuer", async () => {
    const token = await makeToken({}, { issuer: "https://evil.example.com" });
    await expect(verifyGoogleIdToken(token)).rejects.toThrow(
      "google:IdTokenInvalid"
    );
  });

  it("rejects an expired token beyond the clock tolerance", async () => {
    const token = await makeToken({}, { expiresIn: "-5m" });
    await expect(verifyGoogleIdToken(token)).rejects.toThrow(
      "google:IdTokenInvalid"
    );
  });

  it("rejects a tampered payload", async () => {
    const token = await makeToken();
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: WEB_CLIENT_ID,
        sub: "attacker",
        email: "victim@example.com",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      })
    ).toString("base64url");

    await expect(
      verifyGoogleIdToken(`${header}.${forged}.${signature}`)
    ).rejects.toThrow("google:IdTokenInvalid");
  });

  it("rejects an unverified email so it cannot hijack an account by address", async () => {
    const token = await makeToken({ email_verified: false });
    await expect(verifyGoogleIdToken(token)).rejects.toThrow(
      "google:EmailNotVerified"
    );
  });

  it("rejects a token with no email claim", async () => {
    const token = await makeToken({ email: undefined });
    await expect(verifyGoogleIdToken(token)).rejects.toThrow(
      "google:IdTokenIncomplete"
    );
  });

  it("fails closed when no audience is configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(verifyGoogleIdToken(await makeToken())).rejects.toThrow(
      "google:AudienceNotConfigured"
    );
  });

  it("rejects an empty token", async () => {
    await expect(verifyGoogleIdToken("")).rejects.toThrow(
      "google:IdTokenMissing"
    );
  });

  it("falls back to the email when the token carries no name", async () => {
    const token = await makeToken({ name: undefined, given_name: undefined });
    await expect(verifyGoogleIdToken(token)).resolves.toMatchObject({
      name: "joe@example.com",
    });
  });
});
