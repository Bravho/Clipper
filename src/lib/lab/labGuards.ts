/**
 * Process-wide guard for paid provider work. A code constant, not an
 * environment variable, so it cannot be turned on by accident. Every lab entry
 * point (runner, step proxy, draft route, gate) checks it. Changing it needs a
 * code change and Tho's approval. Tests inject their own value instead of
 * changing this one.
 */
export const LAB_PROVIDER_EXECUTION_ENABLED = false;

/**
 * Live kill switch. `isStopped()` is read before every new action and inside
 * every wait. Production answers from a poller that asks the server gate; the
 * server gates stay authoritative for each request.
 */
export interface LabLiveGuard {
  isStopped(): boolean;
}

/** A guard that never stops. Used only where the caller supplies the real one. */
export const neverStopped: LabLiveGuard = { isStopped: () => false };
