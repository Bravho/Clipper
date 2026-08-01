/**
 * The origin the BROWSER can reach this app at.
 *
 * WHY `new URL(request.url).origin` IS WRONG IN PRODUCTION. Next.js derives a
 * route handler's `request.url` from the connection it actually received. In
 * production that connection comes from nginx, which proxies to the app on
 * `localhost:3000` — so `request.url` reads `http://localhost:3000/...` no
 * matter that the visitor is on `https://rclipper.com`. Any redirect built from
 * it points the user's browser at port 3000 on THEIR OWN machine. That is what
 * threw `ERR_SSL_PROTOCOL_ERROR` at the end of a social connection that had
 * already succeeded, and it would equally have sent a paying customer to
 * localhost on the way back from the payment gateway.
 *
 * The order below is deliberate:
 *
 *   1. `x-forwarded-host` — a proxy explicitly stating the public host. This is
 *      the answer whenever the deployment is configured to send it, and it is
 *      the only source that stays correct if the domain ever changes.
 *   2. `NEXTAUTH_URL` in production — the deployment's canonical public origin.
 *      It is already required, already used by NextAuth to build sign-in
 *      callbacks, and already correct in every environment, so a proxy that
 *      forwards no headers still cannot strand us on localhost.
 *   3. The request origin — right for local development, where the app is
 *      genuinely the thing the browser connected to. Loopback is forced to
 *      `http`, because nothing serves TLS on a dev port and an OAuth hand-off
 *      can arrive marked `https` regardless.
 *
 * Step 2 is gated on production precisely so it cannot fire during local
 * development, where `NEXTAUTH_URL` is pinned to `https://rclipper.com` and
 * would eject a developer from their own session mid-flow.
 */

/** Hosts that mean "this machine" — either a dev box or a proxy's upstream. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host)
  );
}

/** First entry of a possibly comma-chained proxy header. */
function firstHop(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

export function appOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = firstHop(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHop(request.headers.get("x-forwarded-host"));

  // 1. The proxy told us the public host.
  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }

  // 2. Production behind a proxy that forwards nothing useful.
  if (process.env.NODE_ENV === "production") {
    const configured = process.env.NEXTAUTH_URL?.trim();
    if (configured) {
      try {
        return new URL(configured).origin;
      } catch {
        console.error("[appOrigin] NEXTAUTH_URL is not a valid URL; using request origin");
      }
    }
  }

  // 3. Local development.
  const protocol = forwardedProto
    ? `${forwardedProto}:`
    : isLoopback(url.hostname)
      ? "http:"
      : url.protocol;
  return `${protocol}//${url.host}`;
}

/** An absolute, browser-reachable URL for a path within this app. */
export function appUrl(request: Request, path: string): URL {
  return new URL(path, appOrigin(request));
}
