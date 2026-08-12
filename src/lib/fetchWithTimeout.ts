/**
 * `fetch` that always settles.
 *
 * A browser `fetch` has no default timeout: if the server accepts the
 * connection and then blocks — which is exactly what happened while a mail send
 * sat on a dropped SMTP packet — the promise never settles and any button
 * driven by `loading={isSubmitting}` spins forever. Nothing in the UI can
 * recover from that, so the deadline belongs here rather than in each caller.
 *
 * `AbortSignal.timeout()` is deliberately not used: it is missing from the
 * Android System WebView versions the Capacitor shell still runs on.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export class RequestTimeoutError extends Error {
  constructor(readonly url: string, readonly ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // An abort raised by our own timer is a timeout; an abort from a caller's
    // signal, or any other network error, is passed through unchanged.
    if (controller.signal.aborted) {
      throw new RequestTimeoutError(input, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
