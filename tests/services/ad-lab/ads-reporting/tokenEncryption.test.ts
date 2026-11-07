import { encryptToken, decryptToken, AdsEncryptionKeyMissingError } from "@/services/ad-lab/ads-reporting/tokenEncryption";

const TEST_KEY_HEX = "a".repeat(64); // 32-byte hex key
const TEST_KEY_B64 = Buffer.from("a".repeat(32)).toString("base64"); // 32-byte base64

describe("tokenEncryption", () => {
  it("encrypts and decrypts a token (hex key)", () => {
    const plain = "my_secret_access_token_123";
    const enc = encryptToken(plain, TEST_KEY_HEX);
    expect(enc).not.toBe(plain);
    expect(decryptToken(enc, TEST_KEY_HEX)).toBe(plain);
  });

  it("encrypts and decrypts a token (base64 key)", () => {
    const plain = "token_base64_key_test";
    const enc = encryptToken(plain, TEST_KEY_B64);
    expect(decryptToken(enc, TEST_KEY_B64)).toBe(plain);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const enc1 = encryptToken("same", TEST_KEY_HEX);
    const enc2 = encryptToken("same", TEST_KEY_HEX);
    expect(enc1).not.toBe(enc2);
    expect(decryptToken(enc1, TEST_KEY_HEX)).toBe("same");
    expect(decryptToken(enc2, TEST_KEY_HEX)).toBe("same");
  });

  it("throws AdsEncryptionKeyMissingError when no key env", () => {
    const old = process.env.ADS_REPORTING_ENCRYPTION_KEY;
    delete process.env.ADS_REPORTING_ENCRYPTION_KEY;
    expect(() => encryptToken("tok")).toThrow(AdsEncryptionKeyMissingError);
    expect(() => decryptToken("enc")).toThrow(AdsEncryptionKeyMissingError);
    if (old !== undefined) process.env.ADS_REPORTING_ENCRYPTION_KEY = old;
  });

  it("throws when ciphertext is tampered", () => {
    const enc = encryptToken("data", TEST_KEY_HEX);
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip last byte
    expect(() => decryptToken(buf.toString("base64"), TEST_KEY_HEX)).toThrow();
  });
});
