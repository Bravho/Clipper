"use client";

interface CostConfirmDialogProps {
  open: boolean;
  title: string;
  lines: string[];
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CostConfirmDialog({
  open,
  title,
  lines,
  confirmLabel = "ยืนยันและดำเนินการ",
  onConfirm,
  onCancel,
}: CostConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <ul className="mt-3 space-y-1.5">
          {lines.map((line, i) => (
            <li key={i} className="text-sm text-slate-700">
              {line}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
