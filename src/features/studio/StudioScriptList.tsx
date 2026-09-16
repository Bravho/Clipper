"use client";

import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import type { StudioChannel, StudioScriptDraft } from "@/domain/models/Studio";

const channelLabels: Record<StudioChannel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

function formatUpdatedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

interface StudioScriptListProps {
  /** Scripts that belong to the selected brand only. */
  drafts: StudioScriptDraft[];
  /** Script currently open in the editor; null means a new, unsaved script. */
  activeDraftId: string | null;
  onSelect: (draft: StudioScriptDraft) => void;
  onCreate: () => void;
  disabled?: boolean;
}

/** Horizontal, scrollable strip of the selected brand's scripts. */
export function StudioScriptList({ drafts, activeDraftId, onSelect, onCreate, disabled = false }: StudioScriptListProps) {
  const sorted = [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const creatingNew = activeDraftId === null;

  const tileBase = "flex h-full w-full flex-col rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <Card padding="sm">
      <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-slate-900">สคริปต์ของแบรนด์นี้</h2>
        <span className="text-xs text-slate-400">{sorted.length} สคริปต์</span>
      </div>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2" aria-label="รายการสคริปต์">
        <li className="w-40 shrink-0 snap-start">
          <button
            type="button"
            onClick={onCreate}
            disabled={disabled}
            aria-current={creatingNew ? "true" : undefined}
            title="สร้างสคริปต์ใหม่"
            className={clsx(
              tileBase,
              "items-center justify-center gap-2 border-dashed text-center",
              creatingNew
                ? "border-blue-600 bg-blue-50 text-blue-800"
                : "border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700"
            )}
          >
            <span
              aria-hidden
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-full text-2xl font-semibold leading-none",
                creatingNew ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
              )}
            >
              +
            </span>
            <span className="text-sm font-medium">สร้างสคริปต์ใหม่</span>
            {creatingNew && <span className="text-xs text-blue-600">กำลังแก้ไข · ยังไม่บันทึก</span>}
          </button>
        </li>
        {sorted.map((draft) => {
          const active = draft.id === activeDraftId;
          const approved = draft.status === "approved";
          const meta = [
            draft.duration ? `${draft.duration} วินาที` : "",
            draft.channels.map((channel) => channelLabels[channel]).join(", "),
          ].filter(Boolean).join(" · ");
          const displayTitle = draft.title.trim() || "ยังไม่มีชื่อคลิป";
          return (
            <li key={draft.id} className="w-64 shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onSelect(draft)}
                disabled={disabled}
                aria-current={active ? "true" : undefined}
                title={displayTitle}
                className={clsx(
                  tileBase,
                  "gap-1",
                  active
                    ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                    : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"
                )}
              >
                <span
                  className={clsx(
                    "self-start rounded-full px-2 py-0.5 text-xs font-semibold",
                    approved ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                  )}
                >
                  {approved ? "อนุมัติแล้ว" : "Draft"}
                </span>
                <span className={clsx("line-clamp-2 text-sm font-semibold", active ? "text-blue-900" : "text-slate-900")}>
                  {displayTitle}
                </span>
                {draft.mainHook.trim() && (
                  <span className="truncate text-xs text-slate-500">{draft.mainHook}</span>
                )}
                <span className="mt-auto pt-1 text-xs text-slate-400">
                  {meta && <span className="block truncate">{meta}</span>}
                  <span className="block">แก้ไขล่าสุด {formatUpdatedAt(draft.updatedAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
