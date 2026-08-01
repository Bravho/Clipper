"use client";

import Link from "next/link";
import { useState } from "react";
import { ROUTES } from "@/config/routes";
import { DeleteDraftButton } from "@/features/requests/components/DeleteDraftButton";

interface DraftRequest {
  id: string;
  title: string;
}

interface DraftRequestsBannerProps {
  drafts: DraftRequest[];
}

export function DraftRequestsBanner({ drafts }: DraftRequestsBannerProps) {
  const [deletedDraftIds, setDeletedDraftIds] = useState<Set<string>>(
    () => new Set()
  );
  const visibleDrafts = drafts.filter((draft) => !deletedDraftIds.has(draft.id));

  if (visibleDrafts.length === 0) return null;

  const handleDeleted = (requestId: string) => {
    setDeletedDraftIds((ids) => new Set(ids).add(requestId));
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-700">
        คุณมีแบบร่างที่ยังไม่ได้บันทึก {visibleDrafts.length} รายการ
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {visibleDrafts.map((draft) => (
          <div
            key={draft.id}
            className="flex items-center justify-between rounded-lg bg-white border border-slate-200 px-4 py-2 hover:shadow-sm transition-shadow"
          >
            <span className="text-sm text-slate-800">
              {draft.title || "แบบร่างไม่มีชื่อ"}
            </span>
            <div className="flex items-center gap-4">
              <DeleteDraftButton requestId={draft.id} onDeleted={handleDeleted} />
              <Link
                href={`${ROUTES.REQUESTS_NEW}?edit=${draft.id}`}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                ดำเนินการต่อ →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
