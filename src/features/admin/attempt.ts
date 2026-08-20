/**
 * Run a data load and capture the failure instead of letting it kill the page.
 *
 * Why this exists: when a server component throws, Next renders the global
 * error page and — in PRODUCTION — replaces the message with an opaque
 * `digest` hash. The admin sees "Application error: a server-side exception has
 * occurred. Digest: 1258508842" and nothing else. The real message only reaches
 * the server log, which is exactly what an admin looking at their phone cannot
 * read.
 *
 * These analytics pages aggregate across a dozen tables whose shapes differ
 * between environments (uuid-or-text ids, tables added by a migration that may
 * not have run, legacy enum values the code has never seen). A single unlucky
 * query should degrade one section, not blank the page and hide its own cause.
 *
 * So: catch, keep the message, and let the page render an inline panel. This is
 * an admin-only surface — the audience for the stack trace IS the person who can
 * act on it.
 */

export type Attempt<T> =
  | { ok: true; data: T }
  | { ok: false; error: AttemptError };

export interface AttemptError {
  message: string;
  /** Postgres error code, when the failure came from the database. */
  code?: string;
  /** `relation "x" does not exist` puts the offending object here. */
  detail?: string;
  stack?: string;
}

export async function attempt<T>(load: () => Promise<T>, label: string): Promise<Attempt<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    // Still log it: the server log remains the record of what happened, and this
    // keeps the failure greppable even though the page now shows it too.
    console.error(`[admin-analytics] ${label} failed:`, err);
    return { ok: false, error: describeError(err, label) };
  }
}

function describeError(err: unknown, label: string): AttemptError {
  if (err instanceof Error) {
    // `pg` hangs its own fields off the Error — code, detail, hint, position.
    const pg = err as Error & { code?: string; detail?: string; hint?: string };
    return {
      message: `${label}: ${err.message}`,
      code: typeof pg.code === "string" ? pg.code : undefined,
      detail:
        [pg.detail, pg.hint].filter((part) => typeof part === "string" && part).join(" · ") ||
        undefined,
      stack: err.stack,
    };
  }
  return { message: `${label}: ${String(err)}` };
}
