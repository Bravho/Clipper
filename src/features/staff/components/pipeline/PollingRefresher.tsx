"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

interface Props {
  intervalMs: number;
}

/** Silently re-navigates to the current URL at the given interval. Used during async AI steps. */
export function PollingRefresher({ intervalMs }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const timer = setInterval(() => router.push(pathname), intervalMs);
    return () => clearInterval(timer);
  }, [router, pathname, intervalMs]);

  return null;
}
