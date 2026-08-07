import {
  configuredAudiences,
  verifyIdToken,
  type VerifiedIdentity,
} from "@/lib/auth/oidcVerify";

/**
 * Google ID token verification for the native Android sign-in flow.
 *
 * @see src/lib/auth/oidcVerify.ts for why the native flow exists.
 * @see https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** Google still emits the bare host form for some clients. Both are valid. */
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Every client ID that may legitimately appear in the token's `aud` claim.
 *
 * Android Credential Manager is initialised with the *web* client ID as its
 * serverClientId, so `aud` is normally `GOOGLE_CLIENT_ID`. The extra env vars
 * cover setups that mint tokens against a dedicated Android or iOS client.
 */
export function googleAudiences(): string[] {
  return configuredAudiences(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID
  );
}

export type VerifiedGoogleIdentity = VerifiedIdentity;

export async function verifyGoogleIdToken(
  idToken: string
): Promise<VerifiedGoogleIdentity> {
  return verifyIdToken({
    provider: "google",
    idToken,
    jwksUrl: GOOGLE_JWKS_URL,
    issuers: GOOGLE_ISSUERS,
    audiences: googleAudiences(),
  });
}
