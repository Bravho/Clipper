import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Shared OpenID Connect ID-token verification for the native (in-app) sign-in
 * flows on Android and iOS.
 *
 * Why native sign-in exists at all: Chrome Custom Tabs (Android) and
 * SFSafariViewController (iOS 11+) each have their own cookie jar, separate from
 * the Capacitor WebView. Completing OAuth in one of them sets the NextAuth
 * session cookie *in the browser*, leaving the app itself signed out — the
 * "it logged me in in another browser" symptom. The native flows hand us an ID
 * token in-process instead, which is exchanged for a session on a request the
 * WebView makes itself.
 *
 * An ID token is attacker-supplied input. Nothing in it is trusted until the
 * signature, `iss`, `aud` and `exp` have all been checked against the issuer's
 * published JWKS here.
 */

/** Cached per JWKS URL — `jose` handles refresh and rate limiting internally. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(url: string) {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

export interface OidcClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  is_private_email?: boolean | string;
}

export interface VerifiedIdentity {
  /** The issuer's stable user identifier (`sub`) — used as providerAccountId. */
  providerAccountId: string;
  email: string;
  name: string;
}

/** Machine-readable failure reasons, safe to log. */
export type IdTokenErrorCode =
  | "IdTokenMissing"
  | "AudienceNotConfigured"
  | "IdTokenInvalid"
  | "EmailNotVerified"
  | "IdTokenIncomplete";

export class IdTokenError extends Error {
  constructor(
    public readonly code: IdTokenErrorCode,
    public readonly provider: string
  ) {
    super(`${provider}:${code}`);
    this.name = "IdTokenError";
  }
}

interface VerifyOptions {
  /** Provider label used in error messages and logs. */
  provider: string;
  idToken: string;
  jwksUrl: string;
  /** Every issuer string the provider may legitimately use. */
  issuers: string[];
  /** Every client ID that may legitimately appear in `aud`. */
  audiences: string[];
  /**
   * Display name to use when the token carries no name claim. Apple omits names
   * from the identity token entirely and only returns them to the client on the
   * very first authorization, so that value is passed through here.
   */
  fallbackName?: string;
}

const MAX_NAME_LENGTH = 120;

/**
 * Client-supplied display names are untrusted (Apple's name arrives from the
 * device, not from the signed token), so strip control characters and cap length.
 */
function sanitiseName(value: string | undefined): string {
  if (!value) return "";
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * Verify an OIDC ID token and return the identity it attests to.
 *
 * @throws IdTokenError on any failure — never returns a partially trusted result.
 */
export async function verifyIdToken({
  provider,
  idToken,
  jwksUrl,
  issuers,
  audiences,
  fallbackName,
}: VerifyOptions): Promise<VerifiedIdentity> {
  if (!idToken || typeof idToken !== "string") {
    throw new IdTokenError("IdTokenMissing", provider);
  }

  if (audiences.length === 0) {
    // Fail closed. Without a configured audience, a token minted for any
    // unrelated app by the same issuer would otherwise be accepted.
    throw new IdTokenError("AudienceNotConfigured", provider);
  }

  let claims: OidcClaims;
  try {
    const { payload } = await jwtVerify(idToken, getJwks(jwksUrl), {
      issuer: issuers,
      audience: audiences,
      // ID tokens are short-lived; allow a little device clock drift.
      clockTolerance: 60,
    });
    claims = payload as OidcClaims;
  } catch {
    throw new IdTokenError("IdTokenInvalid", provider);
  }

  const emailVerified =
    claims.email_verified === true || claims.email_verified === "true";
  if (!emailVerified) {
    // Unverified addresses must never reach findOrCreateOAuthUser: that path
    // links accounts by email, so an unverified token could take over an
    // existing account by claiming its address.
    throw new IdTokenError("EmailNotVerified", provider);
  }

  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub || !email) {
    throw new IdTokenError("IdTokenIncomplete", provider);
  }

  const name =
    sanitiseName(claims.name) ||
    sanitiseName(
      [claims.given_name, claims.family_name].filter(Boolean).join(" ")
    ) ||
    sanitiseName(fallbackName) ||
    email;

  return { providerAccountId: sub, email, name };
}

/** Filter out unset/blank env values so a stray empty string never widens `aud`. */
export function configuredAudiences(...values: (string | undefined)[]): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}
