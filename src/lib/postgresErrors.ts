const retryableConnectionMessages = [
  "connection terminated",
  "connection timeout",
  "connection terminated unexpectedly",
  "econnreset",
  "etimedout",
  "server closed the connection",
];

/** Identify network/pool failures without masking SQL or authentication errors. */
export function isTransientPostgresConnectionError(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    const message = current.message.toLowerCase();
    if (retryableConnectionMessages.some((fragment) => message.includes(fragment))) return true;
    current = current.cause;
  }
  return false;
}
