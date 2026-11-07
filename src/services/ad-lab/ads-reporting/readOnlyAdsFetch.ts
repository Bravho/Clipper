/**
 * Read-only HTTP guard for ads-reporting API calls.
 *
 * Only fetches explicitly listed (method, host, path) combinations. Everything
 * else — including any write-like method, path, or query param — throws
 * AdsReadOnlyViolation BEFORE the network call is made.
 *
 * Hosts:
 *   business-api.tiktok.com — TikTok Business API v1.3
 *   graph.facebook.com      — Meta Graph API
 *
 * The TikTok portal auth URL (https://business-api.tiktok.com/portal/auth) is
 * built as a string only and never passed to this function.
 */

export class AdsReadOnlyViolation extends Error {
  constructor(method: string, url: string) {
    super(`AdsReadOnlyViolation: ${method} ${url} is not in the read-only allowlist`);
    this.name = "AdsReadOnlyViolation";
  }
}

/** Thai message shown whenever an ads write (create/update/delete) is attempted. */
export const ADS_READ_ONLY_MESSAGE_TH =
  "ระบบนี้อ่านข้อมูลโฆษณาได้อย่างเดียว ไม่สามารถสร้าง/แก้ไข/ลบแคมเปญหรือโฆษณาได้";

/** Typed error for any blocked TikTok/Meta ads write. API routes map it to HTTP 403. */
export class AdsWriteBlockedError extends Error {
  readonly code = "ads_write_blocked" as const;
  constructor(public readonly operation: string) {
    super(ADS_READ_ONLY_MESSAGE_TH);
    this.name = "AdsWriteBlockedError";
  }
}

/**
 * Call at the top of any legacy ads write function. Always throws, before any network call.
 * Return type is void (not never) so the legacy body stays type-checked but is unreachable at runtime.
 */
export function assertAdsWriteAllowed(operation: string): void {
  throw new AdsWriteBlockedError(operation);
}

/** True for both guard errors (blocked write function or blocked HTTP request). */
export function isAdsWriteBlocked(err: unknown): err is AdsWriteBlockedError | AdsReadOnlyViolation {
  return err instanceof AdsWriteBlockedError || err instanceof AdsReadOnlyViolation;
}

// Paths that must never be called regardless of method (extra safety layer)
const BLOCKED_PATH_FRAGMENTS = ["create", "update", "delete", "budget", "pause"];

function guardTikTok(method: string, url: URL): void {
  const path = url.pathname;
  // Only three endpoints allowed on TikTok
  if (
    method === "POST" && path === "/open_api/v1.3/oauth2/access_token/"
  ) return;
  if (
    method === "GET" && path === "/open_api/v1.3/oauth2/advertiser/get/"
  ) return;
  if (
    method === "GET" && path === "/open_api/v1.3/report/integrated/get/"
  ) return;
  throw new AdsReadOnlyViolation(method, url.toString());
}

function guardMeta(method: string, url: URL): void {
  // Any non-GET is forbidden
  if (method !== "GET") throw new AdsReadOnlyViolation(method, url.toString());

  // method= query param spoofing
  const methodParam = url.searchParams.get("method");
  if (methodParam && /^(post|put|patch|delete)$/i.test(methodParam)) {
    throw new AdsReadOnlyViolation(method, url.toString());
  }

  const path = url.pathname;

  // Block any path containing write-like segments
  const lcPath = path.toLowerCase();
  for (const fragment of BLOCKED_PATH_FRAGMENTS) {
    if (lcPath.includes(fragment)) throw new AdsReadOnlyViolation(method, url.toString());
  }

  // Allowlist: /vXX.X/<permitted-resource>
  const allowed =
    /^\/v\d+\.\d+\/oauth\/access_token$/.test(path) ||
    /^\/v\d+\.\d+\/me$/.test(path) ||
    /^\/v\d+\.\d+\/me\/adaccounts$/.test(path) ||
    /^\/v\d+\.\d+\/act_\d+\/insights$/.test(path) ||
    /^\/v\d+\.\d+\/debug_token$/.test(path);

  if (!allowed) throw new AdsReadOnlyViolation(method, url.toString());
}

/**
 * The sole fetch wrapper for all ads-reporting network calls.
 * Validates method + host + path before making the request.
 */
export async function readOnlyAdsFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AdsReadOnlyViolation("UNKNOWN", url);
  }

  const method = ((options?.method as string | undefined) ?? "GET").toUpperCase();

  // Only HTTPS, no credentials in the URL, and no method-override tricks.
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new AdsReadOnlyViolation(method, url);
  }
  const headers = new Headers(options?.headers ?? undefined);
  for (const h of ["x-http-method-override", "x-http-method", "x-method-override"]) {
    if (headers.has(h)) throw new AdsReadOnlyViolation(method, url);
  }

  if (parsed.host === "business-api.tiktok.com" || parsed.host === "sandbox-ads.tiktok.com") {
    guardTikTok(method, parsed);
  } else if (parsed.host === "graph.facebook.com") {
    guardMeta(method, parsed);
  } else {
    throw new AdsReadOnlyViolation(method, url);
  }

  return fetch(url, options);
}
