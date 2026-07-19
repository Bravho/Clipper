export default function RequestDetailLoading() {
  return (
    <div
      className="mx-auto max-w-3xl animate-pulse px-4 py-10"
      role="status"
      aria-label="Loading request details"
    >
      <div className="mb-6 h-4 w-64 rounded bg-slate-200" />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="w-full">
          <div className="h-8 w-2/3 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-40 rounded bg-slate-100" />
        </div>
        <div className="h-7 w-24 rounded-full bg-slate-200" />
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
        <div className="h-4 w-5/6 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-2/3 rounded bg-slate-100" />
        <div className="mt-5 h-16 rounded-lg bg-slate-100" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="h-5 w-48 rounded bg-slate-200" />
        <div className="mt-5 space-y-3">
          <div className="h-12 rounded bg-slate-100" />
          <div className="h-12 rounded bg-slate-100" />
          <div className="h-12 rounded bg-slate-100" />
        </div>
      </div>

      <span className="sr-only">Loading request details…</span>
    </div>
  );
}
