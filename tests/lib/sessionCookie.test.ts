import { sessionCookieName } from "@/lib/auth/sessionCookie";

const SECURE = "__Secure-next-auth.session-token";
const PLAIN = "next-auth.session-token";

describe("sessionCookieName mirrors NextAuth's cookie choice", () => {
  it("follows the request protocol when AUTH_TRUST_HOST is set (the localhost case)", () => {
    const env = { AUTH_TRUST_HOST: "true", NEXTAUTH_URL: "https://rclipper.com" };
    expect(sessionCookieName("http", env)).toBe(PLAIN);
    expect(sessionCookieName("https", env)).toBe(SECURE);
    expect(sessionCookieName("https,http", env)).toBe(SECURE);
    // NextAuth treats a missing x-forwarded-proto as https.
    expect(sessionCookieName(null, env)).toBe(SECURE);
  });

  it("follows NEXTAUTH_URL when the host is not trusted", () => {
    expect(sessionCookieName("http", { NEXTAUTH_URL: "https://rclipper.com" })).toBe(SECURE);
    expect(sessionCookieName("https", { NEXTAUTH_URL: "http://localhost:3000" })).toBe(PLAIN);
    expect(sessionCookieName(null, {})).toBe(PLAIN);
  });

  it("treats Vercel like a trusted host", () => {
    expect(sessionCookieName("http", { VERCEL: "1", NEXTAUTH_URL: "https://x.dev" })).toBe(PLAIN);
  });
});
