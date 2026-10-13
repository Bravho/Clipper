"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { forgetDeletedDraft } from "@/features/requests/draftStorage";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { useI18n } from "@/i18n/client";

interface CancelRequestButtonProps {
  requestId: string;
  status: RequestStatus;
}

export function CancelRequestButton({ requestId, status }: CancelRequestButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const isDraft = status === RequestStatus.Draft;
    const confirmMsg = isDraft
      ? t("requests.confirmDeleteDraft")
      : t("requests.confirmDelete");

    if (!confirm(confirmMsg)) return;

    setIsPending(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        // 404 means the request is already gone server-side (e.g. stale data
        // after a dev server restart) — refresh either way to clear it from the UI.
        //
        // Also drop this draft's local resume state. Without it the "new request"
        // page keeps offering to resume a request that no longer exists, and its
        // stale multipart session ids linger in localStorage indefinitely.
        forgetDeletedDraft(requestId);
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? t("requests.deleteFailed"));
      }
    } catch {
      // Network-level failure (e.g. the dev server restarted/was unreachable) —
      // surface a friendly message instead of an unhandled "Failed to fetch".
      alert(t("common.networkError"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      onClick={handleCancel}
      disabled={isPending}
      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 transition-colors"
    >
      {isPending ? t("common.deleting") : t("common.delete")}
    </button>
  );
}
