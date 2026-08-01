import { appOrigin, appUrl } from "@/lib/appOrigin";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

/** NODE_ENV is readonly in the Next types; tests need to drive it. */
function setNodeEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("appOrigin", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    setNodeEnv(originalEnv ?? "test");
    process.env.NEXTAUTH_URL = originalUrl;
  });

  it("uses the public host a proxy forwards, not the upstream it dialled", () => {
    // The production bug: nginx proxies to localhost:3000, so Next.js reports
    // that as the request URL and every redirect pointed the visitor's browser
    // at port 3000 on their own machine.
    expect(
      appOrigin(
        request("http://localhost:3000/api/management/social-accounts/callback", {
          "x-forwarded-host": "rclipper.com",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://rclipper.com");
  });

  it("assumes https when a proxy forwards a host but no protocol", () => {
    expect(
      appOrigin(request("http://localhost:3000/api/x", { "x-forwarded-host": "rclipper.com" }))
    ).toBe("https://rclipper.com");
  });

  it("takes the first entry of a proxy chain", () => {
    expect(
      appOrigin(
        request("http://localhost:3000/api/x", {
          "x-forwarded-host": "rclipper.com, internal.lb",
          "x-forwarded-proto": "https, http",
        })
      )
    ).toBe("https://rclipper.com");
  });

  it("falls back to NEXTAUTH_URL in production when the proxy forwards nothing", () => {
    // A proxy without `proxy_set_header X-Forwarded-Host` still must not strand
    // the user on localhost.
    setNodeEnv("production");
    process.env.NEXTAUTH_URL = "https://rclipper.com";
    expect(appOrigin(request("http://localhost:3000/api/x"))).toBe("https://rclipper.com");
  });

  it("never sends a local developer to the production origin", () => {
    // `.env.local` pins NEXTAUTH_URL to production, so the fallback above is
    // gated on NODE_ENV or it would eject a developer mid-OAuth.
    setNodeEnv("development");
    process.env.NEXTAUTH_URL = "https://rclipper.com";
    expect(appOrigin(request("http://localhost:3000/api/x"))).toBe("http://localhost:3000");
  });

  it("downgrades a loopback host to http in development", () => {
    // An OAuth hand-off can arrive marked https; nothing serves TLS on port 3000.
    setNodeEnv("development");
    delete process.env.NEXTAUTH_URL;
    expect(appOrigin(request("https://localhost:3000/api/x"))).toBe("http://localhost:3000");
    expect(appOrigin(request("https://127.0.0.1:3000/api/x"))).toBe("http://127.0.0.1:3000");
  });

  it("keeps a real request origin when there is no proxy and no loopback", () => {
    setNodeEnv("development");
    delete process.env.NEXTAUTH_URL;
    expect(appOrigin(request("https://rclipper.com/api/x"))).toBe("https://rclipper.com");
  });

  it("preserves the path and query it is given", () => {
    expect(
      appUrl(
        request("http://localhost:3000/api/x", { "x-forwarded-host": "rclipper.com" }),
        "/dashboard/management/connections"
      ).toString()
    ).toBe("https://rclipper.com/dashboard/management/connections");
  });
});
