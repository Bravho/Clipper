import {
  configuredAudiences,
  verifyIdToken,
  type VerifiedIdentity,
} from "@/lib/auth/oidcVerify";
import { takeAppleName } from "@/lib/auth/appleNameMemo";

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
 * so both must be accepted. Android is a plain OAuth client and so reuses the
 * Services ID — which is why that flow needed no change here.
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
  const identity = await verifyIdToken({
    provider: "apple",
    idToken,
    jwksUrl: APPLE_JWKS_URL,
    issuers: APPLE_ISSUERS,
    audiences: appleAudiences(),
    fallbackName,
  });

  // On Android the client has no name to forward — the plugin discards the one
  // Apple sends — so `verifyIdToken` will have fallen back to the email address.
  // The callback route parked the real name moments ago; collect it now.
  // Nothing here affects *which* account is used: that is decided entirely by
  // the verified `sub` above.
  if (identity.name === identity.email) {
    const remembered = takeAppleName(identity.providerAccountId);
    if (remembered) return { ...identity, name: remembered };
  }

  return identity;
}
