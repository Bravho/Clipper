import {
  configuredAudiences,
  verifyIdToken,
  type VerifiedIdentity,
} from "@/lib/auth/oidcVerify";

/**
 * Apple identity-token verification for the native iOS Sign in with Apple flow.
 *
 * @see src/lib/auth/oidcVerify.ts for why the native flow exists.
 * @see https://developer.apple.com/documentation/signinwithapple/verifying-a-user
 */

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUERS = ["https://appleid.apple.com"];

/**
 * Valid `aud` values.
 *
 * The web redirect flow uses the **Services ID** (`APPLE_CLIENT_ID`, e.g.
 * `com.rclipper.app.web`). Native ASAuthorizationController on iOS instead uses
 * the app's **bundle ID** (`APPLE_NATIVE_CLIENT_ID`, e.g. `com.rclipper.app`),
 * so both must be accepted.
 *
 * Apple's `sub` is stable per user *per developer team*, and the Services ID is
 * configured under the primary App ID — so the same person gets the same `sub`
 * whether they sign in on the web or natively, and account linking works.
 */
export function appleAudiences(): string[] {
  return configuredAudiences(
    process.env.APPLE_CLIENT_ID,
    process.env.APPLE_NATIVE_CLIENT_ID
  );
}

export type VerifiedAppleIdentity = VerifiedIdentity;

/**
 * @param fallbackName Apple omits name claims from the identity token entirely
 *   and only hands the name to the client on the very first authorization. The
 *   client forwards it here; it is sanitised and used only as a display name.
 */
export async function verifyAppleIdToken(
  idToken: string,
  fallbackName?: string
): Promise<VerifiedAppleIdentity> {
  return verifyIdToken({
    provider: "apple",
    idToken,
    jwksUrl: APPLE_JWKS_URL,
    issuers: APPLE_ISSUERS,
    audiences: appleAudiences(),
    fallbackName,
  });
}
