import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto max-w-md">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-3xl">
          📡
        </div>
        <h1 className="mb-3 text-2xl font-bold text-slate-900">
          คุณกำลังออฟไลน์
        </h1>
        <p className="mb-8 text-slate-500">
          RClipper ต้องใช้อินเทอร์เน็ตเพื่อโหลดข้อมูลล่าสุด — เครดิต สถานะงาน
          และวิดีโอ กรุณาเชื่อมต่อแล้วลองอีกครั้ง
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-6 py-3 font-medium text-white transition hover:bg-slate-800"
        >
          ลองอีกครั้ง
        </Link>
      </div>
    </div>
  );
}
