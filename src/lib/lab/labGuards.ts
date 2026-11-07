/**
 * Process-wide guard for paid provider work. A code constant, not an
 * environment variable, so it cannot be turned on by accident. Every lab entry
 * point (runner, step proxy, draft route, gate) checks it. Changing it needs a
 * code change and Tho's approval. Tests inject their own value instead of
 * changing this one.
 */
export const LAB_PROVIDER_EXECUTION_ENABLED = false;
