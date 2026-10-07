"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AdLabChannel } from "@/domain/models/AdLab";
import { CHANNEL_ACCENT, CHANNEL_LABELS } from "./socialAccountChannels";
import { PROMOTION_PAY_AT, formatBaht } from "./adLabPromotion";

export interface PublishConfirmLine {
  channel: AdLabChannel;
  accountLabel: string;
  /** Planned promotion for this account; null when the post is organic only. */
  promotion: { total: number; daily: number; days: number } | null;
}

/**
 * Last stop before a real post goes out. Lists every destination and, when any
 * paid promotion is planned, the real total — which the owner must explicitly
 * acknowledge, because Ad Lab does not charge it: they pay the platform.
 */
export function PublishConfirmDialog({
  videoName,
  caption,
  lines,
  onConfirm,
  onClose,
}: {
  videoName: string;
  caption: string;
  lines: PublishConfirmLine[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const adTotal = lines.reduce((sum, line) => sum + (line.promotion?.total ?? 0), 0);
  const promotedChannels = Array.from(new Set(lines.filter((l) => l.promotion).map((l) => l.channel)));
  const [acknowledged, setAcknowledged] = useState(adTotal === 0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ad-lab-publish-confirm-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 id="ad-lab-publish-confirm-title" className="text-lg font-semibold text-slate-950">ยืนยันการเผยแพร่จริง</h2>
          <p className="mt-1 text-sm text-slate-500">ตรวจรายการด้านล่างให้ถูกต้อง โพสต์ที่ขึ้นแพลตฟอร์มแล้วลบจากที่นี่ไม่ได้</p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-900">{videoName}</p>
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-slate-600">{caption}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">ปลายทาง {lines.length} บัญชี</h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {lines.map((line, index) => (
                <li key={`${line.channel}-${line.accountLabel}-${index}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHANNEL_ACCENT[line.channel]}`}>
                    {CHANNEL_LABELS[line.channel]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-900">{line.accountLabel}</span>
                  {line.promotion ? (
                    <span className="text-right text-xs text-slate-600">
                      <span className="block font-semibold text-slate-900">{formatBaht(line.promotion.total)}</span>
                      {formatBaht(line.promotion.daily)}/วัน × {line.promotion.days} วัน
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">organic · ฿0</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {adTotal > 0 ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">ค่าโฆษณาที่วางแผนไว้ทั้งหมด</span>
                <span className="text-xl font-bold">{formatBaht(adTotal)}</span>
              </div>
              <p className="mt-2">
                RClipper <strong>ไม่ได้ตัดเงินค่าโฆษณา</strong> และยังไม่ได้ซื้อโฆษณาให้อัตโนมัติ —
                กด “ยืนยัน” จะโพสต์แบบปกติเท่านั้น หลังโพสต์ขึ้นแล้ว คุณต้องเปิดโปรโมทและชำระเงินเองที่:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {promotedChannels.map((channel) => (
                  <li key={channel}><strong>{CHANNEL_LABELS[channel]}</strong>: {PROMOTION_PAY_AT[channel]}</li>
                ))}
              </ul>
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-white/70 p-3 font-medium">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-amber-700"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                ฉันยืนยันงบโฆษณา {formatBaht(adTotal)} และเข้าใจว่าต้องชำระเองที่แพลตฟอร์ม
              </label>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">ไม่มีการโปรโมทแบบเสียเงิน — โพสต์แบบ organic ไม่มีค่าใช้จ่าย</p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="danger" disabled={!acknowledged} onClick={onConfirm}>
            {adTotal > 0 ? `ยืนยันเผยแพร่ · งบโฆษณา ${formatBaht(adTotal)}` : `ยืนยันเผยแพร่ ${lines.length} บัญชี`}
          </Button>
        </div>
      </div>
    </div>
  );
}
