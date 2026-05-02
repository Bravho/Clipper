"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InternalNote } from "@/domain/models/InternalNote";

interface InternalNotesPanelProps {
  requestId: string;
  notes: InternalNote[];
}

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InternalNotesPanel({ requestId, notes }: InternalNotesPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function addNote() {
    setError(null);
    if (!content.trim()) {
      setError("Note content is required.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/staff/notes/${requestId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to save note.");
        }
        setContent("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Internal Notes</h3>
      <p className="text-xs text-slate-500">
        These notes are staff-only and are never shown to the requester.
      </p>

      {/* Note list */}
      {notes.length === 0 ? (
        <p className="text-sm text-slate-400">No internal notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">{note.authorName}</span>
                <span className="text-xs text-slate-400">
                  {formatDateTime(note.createdAt)}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800">
                {note.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* New note form */}
      <div className="space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add an internal note..."
          rows={3}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={addNote}
          disabled={isPending || !content.trim()}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-900 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Note"}
        </button>
      </div>
    </div>
  );
}
