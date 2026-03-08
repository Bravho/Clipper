import Link from "next/link";
import { ROUTES } from "@/config/routes";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white py-8 mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">Clipper</span>
            <span className="text-slate-500 text-sm">
              Managed Short-Video Production
            </span>
          </div>
          <nav className="flex gap-4 text-sm text-slate-500">
            <Link href={ROUTES.TERMS} className="hover:text-slate-900">
              Terms
            </Link>
            <Link href={ROUTES.OWNERSHIP} className="hover:text-slate-900">
              Ownership Rights
            </Link>
            <Link href={ROUTES.PRIVACY} className="hover:text-slate-900">
              Privacy
            </Link>
          </nav>
          <p className="text-xs text-slate-400">
            &copy; {new Date().getFullYear()} Clipper Platform. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
