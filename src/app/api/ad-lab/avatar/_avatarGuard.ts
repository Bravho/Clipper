import { NextResponse } from "next/server";
import { AdLabAvatarError, type AdLabAvatarErrorCode } from "@/services/ad-lab/AdLabAvatarService";

const STATUS: Record<AdLabAvatarErrorCode, number> = {
  not_found: 404,
  not_approved: 409,
  heygen_not_configured: 503,
  elevenlabs_not_configured: 503,
  too_long: 400,
  invalid_voice: 400,
  invalid_image: 400,
  invalid_key: 400,
  invalid_token: 400,
  provider_error: 502,
  rate_limited: 429,
  local_account: 409,
  look_not_found: 404,
  look_not_eligible: 422,
  tts_voice_missing: 422,
  twin_type_invalid: 400,
  twin_too_large: 400,
  twin_duration_invalid: 400,
  twin_consent_conflict: 409,
};

export function avatarErrorResponse(where: string, err: unknown): NextResponse {
  if (err instanceof AdLabAvatarError) {
    const status = STATUS[err.code];
    const headers: Record<string, string> = {};
    if (err.code === "rate_limited" && err.retryAfterSeconds != null) {
      headers["Retry-After"] = String(err.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: err.message, reason: err.code },
      { status, headers }
    );
  }
  console.error(`[${where}]`, err);
  return NextResponse.json(
    { error: "Avatar service is temporarily unavailable." },
    { status: 503 }
  );
}
