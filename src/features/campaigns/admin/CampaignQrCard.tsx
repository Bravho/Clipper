"use client";

import { useEffect, useState } from "react";

/**
 * The campaign QR for the table / counter, with a printable PNG card.
 *
 * The QR holds `https://app.rclipper.com/c/<slug>?k=<key>`: the RClipper app's
 * "Scan shop QR" opens it in the app. The key is what makes the customer page
 * open at all, so "New QR" (rotate) retires every printed copy at once.
 */
export function CampaignQrCard({
  link,
  shopName,
  campaignTitle,
  discountPercent,
  live,
  onRotate,
}: {
  link: string;
  shopName: string;
  campaignTitle: string;
  discountPercent: number;
  live: boolean;
  onRotate: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(async (QRCode) => {
      const url = await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 2, width: 720 });
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [link]);

  const downloadCard = async () => {
    if (!qr) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1650;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0F172A";
    ctx.textAlign = "center";
    ctx.font = "bold 72px Kanit, 'Noto Sans Thai', sans-serif";
    ctx.fillText(shopName, 600, 140, 1080);
    ctx.font = "44px Kanit, 'Noto Sans Thai', sans-serif";
    ctx.fillStyle = "#334155";
    ctx.fillText("ถ่ายวิดีโอสั้น รับของแถม · Shoot a short video, get a gift", 600, 220, 1100);
    const image = new Image();
    image.src = qr;
    await new Promise((resolve) => {
      image.onload = resolve;
    });
    ctx.drawImage(image, 210, 280, 780, 780);
    ctx.fillStyle = "#0F172A";
    ctx.font = "bold 52px Kanit, 'Noto Sans Thai', sans-serif";
    ctx.fillText("สแกนในแอป RClipper", 600, 1160, 1100);
    ctx.font = "40px Kanit, 'Noto Sans Thai', sans-serif";
    ctx.fillStyle = "#334155";
    ctx.fillText("Menu → Scan shop QR · เมนู → สแกน QR ร้านค้า", 600, 1230, 1100);
    ctx.fillText(`เพื่อนรับส่วนลด ${discountPercent}% · Friends get ${discountPercent}% off`, 600, 1320, 1100);
    ctx.font = "32px sans-serif";
    ctx.fillStyle = "#94A3B8";
    ctx.fillText(campaignTitle, 600, 1560, 1100);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${shopName || "campaign"} - QR.png`.replace(/[\\/:*?"<>|]+/g, "");
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start">
      <div className="flex h-48 w-48 flex-shrink-0 items-center justify-center rounded-lg bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
        {qr ? <img src={qr} alt="Campaign QR code" className="h-full w-full" /> : <span className="text-xs text-slate-400">…</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        {!live && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900">
            This campaign is not live: the QR will say so until you press “Go live”.
          </p>
        )}
        <p className="break-all font-mono text-xs text-slate-600">{link}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadCard()}
            className="min-h-[40px] rounded-lg bg-slate-900 px-3 text-sm font-medium text-white"
          >
            Download printable card
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={onRotate}
            className="min-h-[40px] rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700"
          >
            New QR (retire printed ones)
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Customers scan it with the RClipper app (menu → Scan shop QR). A phone camera opens the web page, which asks
          them to use the app.
        </p>
      </div>
    </div>
  );
}
