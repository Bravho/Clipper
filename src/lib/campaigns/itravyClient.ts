import { itravyApiBase } from "@/config/merchantCampaigns";

/**
 * RClipper → iTravy, server to server (X-API-Key = RCLIPPER_API_KEY).
 * Contract: travel_advisor REFERRAL_REDEMPTION_PLAN.md §12.
 *
 *   GET  /api/referral/rclipper/campaigns/:id
 *   POST /api/referral/rclipper/codes
 *        { campaign_id, rclipper_creator_id, install_hash?, creator_ip?,
 *          creator_user_agent?, code?, creator_phone? }
 *
 * RClipper sends ITS code (globally unique, from the unambiguous alphabet,
 * which iTravy's normaliser accepts), so the code burnt into the video is the
 * code iTravy redeems. The call is idempotent per (campaign, creator).
 * `creator_phone` (E.164) is sent once, right after the creator verifies it;
 * iTravy stores only its HMAC and refuses that phone as a redeemer.
 */

export interface ItravyResult<T> {
  ok: boolean;
  status: number;
  reason?: string;
  data?: T;
}

export interface ItravyCampaign {
  id: string;
  name: string;
  status: string;
  discount_label: string;
  merchant: { id: number | string; name: string; slug: string | null };
  redeem_url: string | null;
}

export interface ItravyCode {
  code: string;
  campaign_id: string;
  discount_label: string;
  redeem_url: string | null;
}

const TIMEOUT_MS = 8000;

function apiKey(): string | null {
  return process.env.RCLIPPER_API_KEY?.trim() || null;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ItravyResult<T>> {
  const key = apiKey();
  if (!key) return { ok: false, status: 0, reason: "RCLIPPER_API_KEY_MISSING" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${itravyApiBase()}/api/referral${path}`, {
      method,
      headers: {
        "X-API-Key": key,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json.ok === false) {
      return {
        ok: false,
        status: response.status,
        reason: typeof json.reason === "string" ? json.reason : `HTTP_${response.status}`,
      };
    }
    return { ok: true, status: response.status, data: json as T };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === "AbortError";
    return { ok: false, status: 0, reason: aborted ? "ITRAVY_TIMEOUT" : "ITRAVY_UNREACHABLE" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ItravyClient {
  getCampaign(id: string): Promise<ItravyResult<{ campaign: ItravyCampaign }>>;
  registerCode(input: {
    campaignId: string;
    creatorId: string;
    code: string;
    installHash?: string | null;
    creatorIp?: string | null;
    creatorUserAgent?: string | null;
    creatorPhone?: string | null;
  }): Promise<ItravyResult<ItravyCode>>;
}

export const itravyClient: ItravyClient = {
  getCampaign: (id) =>
    call<{ campaign: ItravyCampaign }>("GET", `/rclipper/campaigns/${encodeURIComponent(id)}`),
  registerCode: (input) =>
    call<ItravyCode>("POST", "/rclipper/codes", {
      campaign_id: input.campaignId,
      rclipper_creator_id: input.creatorId,
      code: input.code,
      ...(input.installHash ? { install_hash: input.installHash } : {}),
      ...(input.creatorIp ? { creator_ip: input.creatorIp } : {}),
      ...(input.creatorUserAgent ? { creator_user_agent: input.creatorUserAgent.slice(0, 400) } : {}),
      ...(input.creatorPhone ? { creator_phone: input.creatorPhone } : {}),
    }),
};

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
