"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  intervalMs: number;
}

/** Silently refreshes the current page at the given interval. Used during async AI steps. */
export function PollingRefresher({ intervalMs }: Props) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
