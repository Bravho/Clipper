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
      if (res.ok) {
        router.push(pathname);
      }
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
