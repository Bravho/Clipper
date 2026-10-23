import { createHash, randomBytes, randomInt } from "crypto";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_MAX_LENGTH,
  campaignInstallPepper,
} from "@/config/merchantCampaigns";

/**
 * Referral codes, campaign slugs, QR keys and install hashes. Server only.
 */

/** A fresh random code from the unambiguous alphabet (crypto RNG). */
export function generateReferralCode(length: number = REFERRAL_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * What a person typed → the stored form, or null when it cannot be a code.
 * Case-insensitive; spaces, dashes and a leading "#" are ignored.
 */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().toUpperCase().replace(/^#/, "").replace(/[\s-]+/g, "");
  if (cleaned.length < REFERRAL_CODE_LENGTH || cleaned.length > REFERRAL_CODE_MAX_LENGTH) {
    return null;
  }
  for (const char of cleaned) {
    if (!REFERRAL_CODE_ALPHABET.includes(char)) return null;
  }
  return cleaned;
}

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Public campaign id for the QR link — random, 8 lowercase characters. */
export function generateCampaignSlug(): string {
  let slug = "";
  for (let i = 0; i < 8; i++) slug += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return slug;
}

export function isCampaignSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{6,16}$/.test(value);
}

/** The secret in the QR link (`?k=`): 96 random bits, URL-safe. */
export function generateQrKey(): string {
  return randomBytes(12).toString("base64url");
}

/** Constant-time-ish comparison for the QR key (short strings). */
export function qrKeyMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * The app's random install id (a UUID it keeps in app-private storage).
 * Anything else is refused — never IMEI, serial, MAC or advertising id.
 */
export function isInstallId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** sha256(pepper | install id). Only this hash is stored. */
export function hashInstallId(installId: string): string {
  return createHash("sha256")
    .update(`${campaignInstallPepper()}|${installId.toLowerCase()}`)
    .digest("hex");
}
