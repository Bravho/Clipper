/**
 * Shared plumbing for the PUBLIC (no-login) Merchant Campaign endpoints.
 *
 * Who may call: anyone holding the campaign's QR link. Every call carries the
 * campaign slug (path), the QR key (`k`, query or body) and the phone's random
 * install id (`X-Install-Id` header) — never a device identifier.
 */
import { NextResponse } from "next/server";
import { CampaignError } from "@/services/campaigns";
import { CAMPAIGN_RATE_LIMITS } from "@/config/merchantCampaigns";
import { allowRequest, clientIp } from "@/lib/campaigns/rateLimit";
import type { CampaignAccess } from "@/services/campaigns/CampaignCreatorService";
import { parseAppUserAgent } from "@/lib/mobile/appUserAgent";

export const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function limited(request: Request, bucket: keyof typeof CAMPAIGN_RATE_LIMITS): NextResponse | null {
  if (allowRequest(`${bucket}:${clientIp(request)}`, CAMPAIGN_RATE_LIMITS[bucket])) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a minute.", code: "rate_limited" },
    { status: 429, headers: NO_STORE }
  );
}

export function installIdOf(request: Request): string | null {
  return request.headers.get("x-install-id");
}

export function platformOf(request: Request): "ios" | "android" | "web" {
  return parseAppUserAgent(request.headers.get("user-agent")).platform ?? "web";
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function accessOf(
  slug: string,
  request: Request,
  body?: Record<string, unknown>
): CampaignAccess {
  const fromQuery = new URL(request.url).searchParams.get("k");
  const fromBody = typeof body?.k === "string" ? body.k : null;
  return { slug, qrKey: fromBody ?? fromQuery };
}

export function failure(error: unknown, label: string): NextResponse {
  if (error instanceof CampaignError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status, headers: NO_STORE }
    );
  }
  console.error(`[api/campaigns] ${label}`, error);
  return NextResponse.json(
    { error: "Something went wrong. Please try again.", code: "server_error" },
    { status: 500, headers: NO_STORE }
  );
}
