"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteDraftButtonProps {
  requestId: string;
}

export function DeleteDraftButton({ requestId }: DeleteDraftButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("Delete this draft? This cannot be undone.")) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
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
      {isDeleting ? "Deleting..." : "Delete"}
    </button>
  );
}
