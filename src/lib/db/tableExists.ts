import { pool } from "@/lib/db";

/**
 * Does a table exist in the connected database?
 *
 * The analytics surface reads four tables added by migration 028
 * (`user_login_events`, `pipeline_gate_events`, `render_worker_samples`, plus
 * the triage columns on `ai_content_reports`). If that migration has not run —
 * or ran against a different database than the one the app is pointed at —
 * every query against them raises `relation "..." does not exist`, and the page
 * dies with an opaque "server-side exception" digest that tells the admin
 * nothing about the actual cause.
 *
 * Checking first lets each page say "this section needs migration 028" and
 * still render everything else. Migration 024 sets the `to_regclass` precedent.
 *
 * Caching: only POSITIVE results are cached. A missing table is re-checked every
 * call, which costs one trivial query and means the page starts working the
 * moment the migration is applied — no server restart, no stale "unavailable"
 * banner that outlives the problem it describes.
 */
const known = new Set<string>();

export async function tableExists(
  table: string,
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } = pool
): Promise<boolean> {
  if (known.has(table)) return true;

  try {
    const { rows } = await db.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`public.${table}`]
    );
    const present = Boolean((rows[0] as { present?: boolean } | undefined)?.present);
    if (present) known.add(table);
    return present;
  } catch {
    // A failure here (permissions, connection) is not evidence of absence, but
    // treating it as "missing" degrades to an explanatory banner rather than a
    // crash — which is the better outcome either way.
    return false;
  }
}

/** Test seam: forget cached positives. */
export function resetTableExistsCache(): void {
  known.clear();
}
