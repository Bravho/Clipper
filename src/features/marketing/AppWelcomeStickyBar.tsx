"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The welcome screen's bottom action bar. It stays hidden while the hero's own
 * buttons are on screen (so the first view never shows the same two buttons
 * twice) and slides in once they scroll away.
 */
export function AppWelcomeStickyBar({ watchId, children }: { watchId: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-5 pt-3 backdrop-blur transition-transform duration-200 app-safe-bottom ${
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      {children}
    </div>
  );
}
