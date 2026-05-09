import Link from "next/link";
import Image from "next/image";
import { ROUTES } from "@/config/routes";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white py-8 mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="RClipper logo" width={28} height={28} className="rounded" />
            <span className="font-semibold text-slate-900">RClipper</span>
            <span className="text-slate-500 text-sm">
              Video Editing Marketplace สำหรับธุรกิจไทย
            </span>
          </div>
          <nav className="flex gap-4 text-sm text-slate-500">
            <Link href={ROUTES.TERMS} className="hover:text-slate-900">
              ข้อกำหนด
            </Link>
            <Link href={ROUTES.OWNERSHIP} className="hover:text-slate-900">
              สิทธิ์ความเป็นเจ้าของ
            </Link>
            <Link href={ROUTES.PRIVACY} className="hover:text-slate-900">
              ความเป็นส่วนตัว
            </Link>
          </nav>
          <p className="text-xs text-slate-400">
            &copy; {new Date().getFullYear()} RClipper. สงวนลิขสิทธิ์
          </p>
        </div>
      </div>
    </footer>
  );
}
