"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * AdminActionButtons — client component for production review actions.
 *
 * Renders admin workflow action buttons (approve, return, hold, reject)
 * for requests in ScheduledForPublishing status.
 *
 * Each action opens a simple inline form for the required note/reason.
 */
export function AdminActionButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<
    "approve" | "return" | "hold" | "reject" | null
  >(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(action: string, body: Record<string, string>) {
    setError(null);
    const res = await fetch(`/api/admin/requests/${requestId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Something went wrong.");
      return;
    }
    setActiveAction(null);
    setNote("");
    startTransition(() => router.refresh());
  }

  function cancel() {
    setActiveAction(null);
    setNote("");
    setError(null);
  }

  if (activeAction === "approve") {
    return (
      <ActionForm
        title="Approve for Publishing"
        notePlaceholder="Optional review note (internal)…"
        submitLabel="Approve"
        submitClass="bg-green-600 hover:bg-green-700 text-white"
        note={note}
        onNoteChange={setNote}
        onSubmit={() => submit("approve", { reviewNote: note })}
        onCancel={cancel}
        isPending={isPending}
        error={error}
      />
    );
  }

  if (activeAction === "return") {
    return (
      <ActionForm
        title="Return to Editing"
        notePlaceholder="Required: describe what needs to be revised…"
        submitLabel="Return to Editing"
        submitClass="bg-yellow-600 hover:bg-yellow-700 text-white"
        note={note}
        onNoteChange={setNote}
        onSubmit={() => submit("return", { revisionNote: note })}
        onCancel={cancel}
        isPending={isPending}
        error={error}
        required
      />
    );
  }

  if (activeAction === "hold") {
    return (
      <ActionForm
        title="Hold Request"
        notePlaceholder="Required: hold reason (shown to requester)…"
        submitLabel="Hold"
        submitClass="bg-amber-600 hover:bg-amber-700 text-white"
        note={note}
        onNoteChange={setNote}
        onSubmit={() => submit("hold", { holdReason: note })}
        onCancel={cancel}
        isPending={isPending}
        error={error}
        required
      />
    );
  }

  if (activeAction === "reject") {
    return (
      <ActionForm
        title="Reject Request"
        notePlaceholder="Required: rejection reason (shown to requester)…"
        submitLabel="Reject"
        submitClass="bg-red-600 hover:bg-red-700 text-white"
        note={note}
        onNoteChange={setNote}
        onSubmit={() => submit("reject", { rejectionReason: note })}
        onCancel={cancel}
        isPending={isPending}
        error={error}
        required
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => setActiveAction("approve")}
        className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition"
      >
        Approve for Publishing
      </button>
      <button
        onClick={() => setActiveAction("return")}
        className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-600 transition"
      >
        Return to Editing
      </button>
      <button
        onClick={() => setActiveAction("hold")}
        className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition"
      >
        Hold
      </button>
      <button
        onClick={() => setActiveAction("reject")}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition"
      >
        Reject
      </button>
    </div>
  );
}

function ActionForm({
  title,
  notePlaceholder,
  submitLabel,
  submitClass,
  note,
  onNoteChange,
  onSubmit,
  onCancel,
  isPending,
  error,
  required,
}: {
  title: string;
  notePlaceholder: string;
  submitLabel: string;
  submitClass: string;
  note: string;
  onNoteChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
  required?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder={notePlaceholder}
        rows={3}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={isPending || (required && !note.trim())}
          className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${submitClass}`}
        >
          {isPending ? "Saving…" : submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
