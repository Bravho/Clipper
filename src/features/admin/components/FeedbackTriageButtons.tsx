"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { FeedbackReportStatus } from "@/services/admin/AdminFeedbackService";

/**
 * Per-row triage controls for `/admin/feedback`.
 *
 * The page is a server component that re-reads the database on every
 * navigation, so this holds no copy of the report: it POSTs, then
 * `router.refresh()` inside a transition re-renders the row server-side with
 * the new status pill. Keeping a local optimistic status would mean two sources
 * of truth for the same row, and a failed POST would leave the wrong one on
 * screen.
 *
 * Errors are shown INLINE under the buttons rather than in an `alert()`: the
 * useful failures here ("Cannot resolve a report that is already dismissed")
 * are ones another admin caused a second ago, and the reader needs the row in
 * front of them while reading it.
 */

type TriageAction = "review" | "resolve" | "dismiss";

/** Actions that ask for an optional note before firing. */
const NOTE_ACTIONS: Record<TriageAction, { title: string; placeholder: string } | null> = {
  review: null,
  resolve: {
    title: "Mark solved",
    placeholder: "What was done? (optional)",
  },
  dismiss: {
    title: "Dismiss report",
    placeholder: "Why is this not actionable? (optional)",
  },
};

export function FeedbackTriageButtons({
  reportId,
  status,
}: {
  reportId: string;
  status: FeedbackReportStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<TriageAction | null>(null);
  const [confirming, setConfirming] = useState<TriageAction | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  // One in-flight action at a time, platform-wide for this row: two triage
  // POSTs racing each other would both target the same status guard and the
  // loser's error would look like a bug.
  const busy = pending !== null || isRefreshing;

  const run = async (action: TriageAction) => {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/${reportId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Action failed. Please try again.");
        return;
      }
      setConfirming(null);
      setNote("");
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const onClick = (action: TriageAction) => {
    setError(null);
    if (NOTE_ACTIONS[action] && confirming !== action) {
      // First click opens the note box; the confirm button inside it fires.
      setConfirming(action);
      setNote("");
      return;
    }
    void run(action);
  };

  const canReview = status === "open";
  const canClose = status === "open" || status === "reviewing";

  // A closed report has nothing left to do. Say so rather than rendering an
  // empty cell, which reads as "the buttons failed to load".
  if (!canReview && !canClose) {
    return <span className="text-xs text-slate-400">No action needed</span>;
  }

  const active = confirming ? NOTE_ACTIONS[confirming] : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canReview && (
          <TriageButton
            label={pending === "review" ? "Accepting…" : "Accept for review"}
            tone="primary"
            disabled={busy}
            onClick={() => onClick("review")}
          />
        )}
        {canClose && (
          <TriageButton
            label="Mark solved"
            tone="good"
            disabled={busy}
            active={confirming === "resolve"}
            onClick={() => onClick("resolve")}
          />
        )}
        {canClose && (
          <TriageButton
            label="Dismiss"
            tone="quiet"
            disabled={busy}
            active={confirming === "dismiss"}
            onClick={() => onClick("dismiss")}
          />
        )}
      </div>

      {active && confirming && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <label className="block text-xs font-medium text-slate-600" htmlFor={`note-${reportId}`}>
            {active.title}
          </label>
          <textarea
            id={`note-${reportId}`}
            value={note}
            rows={2}
            maxLength={2000}
            placeholder={active.placeholder}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
          />
          <div className="flex gap-2">
            <TriageButton
              label={pending === confirming ? "Saving…" : "Confirm"}
              tone="primary"
              disabled={busy}
              onClick={() => void run(confirming)}
            />
            <TriageButton
              label="Cancel"
              tone="quiet"
              disabled={busy}
              onClick={() => {
                setConfirming(null);
                setNote("");
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function TriageButton({
  label,
  tone,
  disabled,
  active,
  onClick,
}: {
  label: string;
  tone: "primary" | "good" | "quiet";
  disabled: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
        tone === "good" && "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
        tone === "quiet" && "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        // The open note box is a mode, so its trigger stays visibly pressed.
        active && "ring-2 ring-slate-300"
      )}
    >
      {label}
    </button>
  );
}
