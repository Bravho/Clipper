/**
 * A tiny fixed-window rate limiter for the no-login campaign endpoints.
 *
 * In memory, per server process: it stops a script hammering the endpoints,
 * which is all the product wants (low friction first). A restart forgets it.
 */
const windows = new Map<string, { start: number; count: number }>();
const WINDOW_MS = 60_000;

export function allowRequest(key: string, perMinute: number, now: number = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 20_000) sweep(now);
    return true;
  }
  current.count += 1;
  return current.count <= perMinute;
}

function sweep(now: number): void {
  windows.forEach((value, key) => {
    if (now - value.start >= WINDOW_MS) windows.delete(key);
  });
}

/** The caller's IP as the proxy reports it (first hop), else "unknown". */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
