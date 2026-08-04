"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { PortalNavSection } from "@/components/layout/PortalNav";

/**
 * Full-height slide-in navigation drawer for phones and small tablets.
 *
 * On mobile there is no room for the desktop sidebar, so every navigation
 * surface — the portal section links plus the account/language controls —
 * collapses into this one panel behind the navbar hamburger.
 *
 * Behaviour notes:
 * - Locks body scroll while open so the page behind cannot rubber-band.
 * - Closes on Escape and on route change.
 * - Respects notch/home-indicator safe areas (Capacitor WebView, PWA).
 * - The panel itself scrolls, so long nav lists stay reachable on short screens.
 */
export function MobileNavDrawer({
  open,
  onClose,
  sections,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Section navigation registered by the current portal shell. */
  sections: PortalNavSection[];
  /** Account / language controls rendered below the section links. */
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Close whenever the route changes — otherwise the drawer stays open on top
  // of the page the user just navigated to.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={clsx(
          "fixed inset-0 z-40 bg-slate-900/60 transition-opacity duration-200 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        className={clsx(
          "fixed right-0 top-0 z-50 flex h-[100dvh] w-[min(20rem,85vw)] flex-col",
          "border-l border-slate-700 bg-slate-900 shadow-2xl",
          "transition-transform duration-200 ease-out lg:hidden",
          open ? "translate-x-0" : "translate-x-full"
        )}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-700 px-4">
          <span className="text-sm font-semibold text-white">RClipper</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-2 rounded p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {sections.map((section) => (
            <div key={section.id} className="mb-5">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                {section.title}
              </p>
              <nav className="flex flex-col gap-0.5">
                {section.links.map((link) => {
                  const active =
                    pathname === link.href ||
                    (link.href !== "/" && pathname?.startsWith(`${link.href}/`));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onClose}
                      className={clsx(
                        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-slate-800 font-medium text-white"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      {link.icon && (
                        <span className="w-4 text-base opacity-60">{link.icon}</span>
                      )}
                      <span className="min-w-0 break-words">{link.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}

          <div
            className={clsx(
              "flex flex-col gap-1",
              sections.length > 0 && "border-t border-slate-700 pt-4"
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
