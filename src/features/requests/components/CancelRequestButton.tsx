"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { RequestStatus } from "@/domain/enums/RequestStatus";

interface CancelRequestButtonProps {
  requestId: string;
  status: RequestStatus;
}

export function CancelRequestButton({ requestId, status }: CancelRequestButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, setIsPending] = useState(false);

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const isDraft = status === RequestStatus.Draft;
    const confirmMsg = isDraft
      ? "ลบแบบร่างนี้? ไม่สามารถย้อนกลับได้"
      : "ยกเลิกคำขอนี้? ไม่สามารถย้อนกลับได้ และเครดิตจะไม่ถูกคืน";

    if (!confirm(confirmMsg)) return;

    setIsPending(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        // 404 means the request is already gone server-side (e.g. stale data
        // after a dev server restart) — refresh either way to clear it from the UI.
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "ไม่สามารถยกเลิกคำขอได้ กรุณาลองใหม่อีกครั้ง");
      }
    } catch {
      // Network-level failure (e.g. the dev server restarted/was unreachable) —
      // surface a friendly message instead of an unhandled "Failed to fetch".
      alert("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
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
      {isPending ? "กำลังยกเลิก..." : "ยกเลิก"}
    </button>
  );
}
