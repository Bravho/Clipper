import type { AttemptError } from "@/features/admin/attempt";

/**
 * Render a caught data-load failure where the admin can actually read it.
 *
 * The whole point: in production Next replaces a thrown error's message with a
 * digest hash, so "Digest: 1258508842" is all the operator gets. This panel is
 * rendered by a SERVER component that caught the error itself, so the real
 * message survives.
 *
 * Showing a stack trace in a UI is normally wrong. It is right here: `/admin` is
 * gated to `Role.Admin` by middleware AND by the layout, the only reader is the
 * person who owns the deployment, and the alternative is a blank page.
 *
 * `hint` translates the common Postgres codes into the actual next action,
 * because "42P01" is not a thing anyone should have to look up.
 */
export function AdminErrorPanel({
  title,
  error,
}: {
  title: string;
  error: AttemptError;
}) {
  const hint = hintFor(error);

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5">
      <h3 className="text-sm font-semibold text-red-900">{title}</h3>

      <p className="mt-2 break-words font-mono text-xs text-red-800">{error.message}</p>

      {error.code && (
        <p className="mt-1 font-mono text-xs text-red-700">
          Postgres code {error.code}
          {error.detail ? ` — ${error.detail}` : ""}
        </p>
      )}

      {hint && (
        <p className="mt-3 rounded border border-red-200 bg-white/60 p-2 text-xs text-red-900">
          <span className="font-semibold">What to do: </span>
          {hint}
        </p>
      )}

      {error.stack && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-red-700">
            Stack trace
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 text-[11px] leading-relaxed text-red-900">
            {error.stack}
          </pre>
        </details>
      )}

      <p className="mt-3 text-xs text-red-600">
        The rest of this page is unaffected — only this section failed to load.
      </p>
    </section>
  );
}

/** Map the failures this surface actually hits to their remedy. */
function hintFor(error: AttemptError): string | null {
  switch (error.code) {
    case "42P01": // undefined_table
      return "A table this section reads does not exist. Apply src/db/migrations/028_admin_analytics.sql to the database this app connects to, and check PGDATABASE — the migration may have run against a different one.";
    case "42703": // undefined_column
      return "A column is missing, so the database is on an older migration than the code. Re-run the pending migrations in src/db/migrations/.";
    case "42883": // undefined_function — classically uuid = text
      return "An operator or function does not exist for these argument types. This is almost always the uuid-vs-text id mismatch: clip_requests.id is uuid in some environments and text in others, so the join needs an explicit ::text cast.";
    case "22P02": // invalid_text_representation
      return "A value could not be parsed into its column type — usually a non-uuid string being compared against a uuid column.";
    case "42501":
      return "The database user lacks permission on this object. Grant SELECT to the application role.";
    default:
      return null;
  }
}
