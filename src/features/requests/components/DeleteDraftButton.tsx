"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { forgetDeletedDraft } from "@/features/requests/draftStorage";
import { useI18n } from "@/i18n/client";

interface DeleteDraftButtonProps {
  requestId: string;
  onDeleted?: (requestId: string) => void;
}

export function DeleteDraftButton({ requestId, onDeleted }: DeleteDraftButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm(t("requests.confirmDeleteDraft"))) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
      if (res.ok) {
        // Drop this draft's local resume state too, so the "new request" page
        // stops offering to resume a draft that no longer exists.
        forgetDeletedDraft(requestId);
        onDeleted?.(requestId);
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? t("requests.deleteDraftFailed"));
      }
    } catch {
      alert(t("common.networkError"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 transition-colors"
    >
      {isDeleting ? t("common.deleting") : t("common.delete")}
    </button>
  );
}
