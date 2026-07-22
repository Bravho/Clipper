type AuthDiagnosticFields = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Structured authentication diagnostics for production troubleshooting.
 * Never pass passwords, email addresses, provider tokens, session tokens, or
 * cookie values to this function.
 */
export function logAuthEvent(
  event: string,
  fields: AuthDiagnosticFields = {}
): void {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
  console.info(
    `[Clipper][auth] ${JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...safeFields,
    })}`
  );
}
