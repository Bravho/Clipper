/* Edge-safe: no Node imports (used by src/middleware.ts). */

/**
 * Which cookie holds the session, decided EXACTLY the way the NextAuth server
 * decides it, so the middleware reads the same cookie the server wrote.
 *
 * NextAuth (v4) uses the `__Secure-` cookie when its origin is https. With
 * AUTH_TRUST_HOST (or on Vercel) that origin comes from the REQUEST
 * (x-forwarded-proto, default https); otherwise from NEXTAUTH_URL. withAuth's
 * own default looks only at NEXTAUTH_URL, so with AUTH_TRUST_HOST=true and
 * NEXTAUTH_URL=https://… on http://localhost the server wrote
 * `next-auth.session-token` while the middleware looked for the `__Secure-`
 * one: every protected page bounced to sign-in, and the signed-in login page
 * bounced back — a redirect loop that showed as a blank page.
 */
export function sessionCookieName(
  forwardedProto: string | null,
  env: { VERCEL?: string; AUTH_TRUST_HOST?: string; NEXTAUTH_URL?: string } = {
    // Static references: read at request time in the edge middleware too.
    VERCEL: process.env.VERCEL,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  }
): string {
  const trustHost = env.VERCEL ?? env.AUTH_TRUST_HOST;
  const secure = trustHost
    ? forwardedProto?.split(",")[0].trim() !== "http"
    : Boolean(env.NEXTAUTH_URL?.startsWith("https://"));
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}
