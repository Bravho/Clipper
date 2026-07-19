export default function NewRequestLoading() {
  return (
    <div
      className="mx-auto max-w-3xl animate-pulse px-4 py-10"
      role="status"
      aria-label="Loading new request"
    >
      <div className="mb-6 h-4 w-64 rounded bg-slate-200" />
      <div className="mb-8">
        <div className="h-8 w-72 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-100" />
      </div>
      <div className="mb-6 h-4 w-80 max-w-full rounded bg-slate-100" />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="h-96 rounded-2xl border-2 border-blue-100 bg-blue-50/60" />
        <div className="h-96 rounded-2xl border-2 border-amber-100 bg-amber-50/60" />
      </div>
      <span className="sr-only">Loading new request…</span>
    </div>
  );
}
