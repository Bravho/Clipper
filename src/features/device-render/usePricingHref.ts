"use client";

import { useEffect, useState } from "react";

import { ROUTES } from "@/config/routes";

/**
 * The Pricing link for a "See packages" button in the studio, carrying the
 * studio's own address as `returnTo` — so Pricing's back link (and a purchase)
 * brings the user back to THIS request at the step it is on, rather than to the
 * dashboard or an empty new request (Tho, 13 Oct).
 *
 * Read after mount (the server render has no window), so the first paint links
 * to plain Pricing and the returnTo is added a moment later. The request id is
 * written into the address bar with replaceState when the brief is saved, so
 * by the time any "See packages" button exists the URL names the request.
 */
export function usePricingHref(): string {
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    setHere(window.location.pathname + window.location.search);
  }, []);
  return here ? `${ROUTES.PRICING}?returnTo=${encodeURIComponent(here)}` : ROUTES.PRICING;
}
