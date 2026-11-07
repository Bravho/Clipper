import crypto from "crypto";

function deriveKey(raw: string): Buffer {
  // Accept 64-char hex (32 bytes) or 44-char base64 (32 bytes); anything else → SHA-256 hash
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  return crypto.createHash("sha256").update(raw).digest();
}

/** AES-256-GCM encrypt. Returns base64(iv[12] || tag[16] || ciphertext). */
export function encryptToken(plaintext: string, keyRaw?: string): string {
  const raw = keyRaw ?? process.env.ADS_REPORTING_ENCRYPTION_KEY;
  if (!raw) throw new AdsEncryptionKeyMissingError();
  const key = deriveKey(raw);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** AES-256-GCM decrypt. Inverse of encryptToken. */
export function decryptToken(enc: string, keyRaw?: string): string {
  const raw = keyRaw ?? process.env.ADS_REPORTING_ENCRYPTION_KEY;
  if (!raw) throw new AdsEncryptionKeyMissingError();
  const key = deriveKey(raw);
  const buf = Buffer.from(enc, "base64");
  if (buf.length < 28) throw new Error("Invalid encrypted token (too short)");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export class AdsEncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "ไม่พบ ADS_REPORTING_ENCRYPTION_KEY — กรุณาตั้งค่า env นี้ก่อนเชื่อมต่อบัญชีโฆษณา (ต้องการ key 32 bytes base64 หรือ 64-char hex)"
    );
    this.name = "AdsEncryptionKeyMissingError";
  }
}
