import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { isAdLabEnabledFor } from "@/config/adLab";
import { AdLabPublishingError } from "@/services/ad-lab/AdLabPublishingService";

/**
 * Shared guard for /api/ad-lab/*. Anyone outside the Ad Lab allowlist gets a
 * 404 (not 401/403) so the endpoints do not reveal that the lab exists.
 */
export async function requireAdLabUser(): Promise<
  { ok: true; user: { id: string; email: string | null } } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user || !isAdLabEnabledFor({ id: user.id, email: user.email })) {
    return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { ok: true, user: { id: user.id, email: user.email ?? null } };
}

const STATUS: Record<AdLabPublishingError["code"], number> = {
  local_account: 409,
  unsupported_type: 400,
  too_large: 400,
  empty_file: 400,
  video_not_found: 400,
  no_targets: 400,
  missing_caption: 400,
  duplicate_target: 400,
  unknown_connection: 400,
  connection_not_connected: 409,
  channel_mismatch: 400,
  not_found: 404,
  not_deletable: 409,
  provider_error: 502,
  insights_unavailable: 502,
};

export function adLabErrorResponse(where: string, err: unknown): NextResponse {
  if (err instanceof AdLabPublishingError) {
    return NextResponse.json({ error: err.message, reason: err.code }, { status: STATUS[err.code] });
  }
  console.error(`[${where}]`, err);
  return NextResponse.json({ error: "Ad Lab is temporarily unavailable." }, { status: 503 });
}
