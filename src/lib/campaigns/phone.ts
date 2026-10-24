import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { campaignInstallPepper } from "@/config/merchantCampaigns";

/**
 * Phone helpers for the creator OTP. Server only.
 *
 * `normalizePhone` follows iTravy's rule exactly
 * (travel_advisor backend/src/services/referral/hashing.js) so a number typed
 * as "081-234-5678" on RClipper and "+66812345678" on iTravy is the same
 * number on both sides: Thai mobiles 06/08/09 + 8 digits, 66XXXXXXXXX, or any
 * +E.164 (tourists). Null when invalid.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/[\s\-().]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(s)) {
    if (s.startsWith("+660")) return "+66" + s.slice(4); // "+66 0812…" typo
    return s;
  }
  if (/^0[689]\d{8}$/.test(s)) return "+66" + s.slice(1);
  if (/^66[689]\d{8}$/.test(s)) return "+" + s;
  return null;
}

/** "+668•••678" — what the screen shows after the SMS is sent. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}•••${e164.slice(-3)}`;
}

function hmac(purpose: string, value: string): string {
  return createHmac("sha256", campaignInstallPepper()).update(`${purpose}:${value}`).digest("hex");
}

/**
 * RClipper's own hash of a verified phone (never sent anywhere). iTravy keeps
 * its own HMAC with its own secret; the RAW number goes to iTravy once,
 * server-to-server, right after it is verified.
 */
export function hashPhone(e164: string): string {
  return hmac("phone", e164);
}

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(challengeId: string, code: string): string {
  return hmac("otp", `${challengeId}:${code}`);
}

export function otpMatches(challengeId: string, code: unknown, storedHash: string): boolean {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return false;
  const a = Buffer.from(hashOtp(challengeId, code.trim()));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
