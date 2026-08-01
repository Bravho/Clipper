"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteDraftButtonProps {
  requestId: string;
  onDeleted?: (requestId: string) => void;
}

export function DeleteDraftButton({ requestId, onDeleted }: DeleteDraftButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("ลบแบบร่างนี้? ไม่สามารถย้อนกลับได้")) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted?.(requestId);
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "ไม่สามารถลบแบบร่างได้ กรุณาลองใหม่อีกครั้ง");
      }
    } catch {
      alert("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
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
      {isDeleting ? "กำลังลบ..." : "ลบ"}
    </button>
  );
}
