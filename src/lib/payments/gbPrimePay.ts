/**
 * GB Prime Pay (Xendit Tech Co., Ltd.) — PromptPay QR client.
 *
 * Two operations are used:
 *   1. createPromptPayQr()  — POST /v3/qrcode → returns a scannable PromptPay QR.
 *   2. getChargeStatus()    — POST /v2/tokens/{referenceNo} status check, used to
 *      re-verify a payment server-to-server before crediting a wallet. We never
 *      trust the webhook body alone.
 *
 * Card payments and recurring billing are intentionally NOT implemented yet.
 *
 * The HTTP layer is injected (`fetchImpl`) so this is unit-testable without
 * hitting the live gateway.
 */
import { PAYMENTS_CONFIG, requireGbPrimePayKeys } from "@/config/payments";

export interface PromptPayQrResult {
  /** Data URL (image/png;base64) of the PromptPay QR to display. */
  qrImageDataUrl: string;
  /** Our reference sent to the gateway (echoed back on the webhook). */
  referenceNo: string;
}

export interface ChargeStatusResult {
  /** True only when the gateway confirms a successful (result "00") payment. */
  paid: boolean;
  /** Gateway's own reference for the transaction, if present. */
  gatewayRef: string | null;
  /** Raw result code returned by the gateway. */
  resultCode: string | null;
  /** Amount the gateway recorded, in baht (for cross-checking). */
  amountBaht: number | null;
}

type FetchImpl = typeof fetch;

/** Basic-auth header GB Prime Pay expects: base64("{key}:"). */
function basicAuth(key: string): string {
  const token = Buffer.from(`${key}:`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Create a PromptPay QR charge.
 * `referenceNo` MUST be unique per intent — it is our idempotency key.
 */
export async function createPromptPayQr(
  params: { amountBaht: number; referenceNo: string; detail: string },
  fetchImpl: FetchImpl = fetch
): Promise<PromptPayQrResult> {
  const { publicKey } = requireGbPrimePayKeys();
  const { baseUrl, webhookUrl } = PAYMENTS_CONFIG.gbPrimePay;

  const res = await fetchImpl(`${baseUrl}/v3/qrcode`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(publicKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amountBaht,
      referenceNo: params.referenceNo,
      detail: params.detail,
      backgroundUrl: webhookUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GB Prime Pay QR create failed (${res.status}): ${text}`);
  }

  // v3/qrcode returns a PNG image body. Convert to a data URL for display.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    // Some accounts return JSON with a base64 image field.
    const json = (await res.json()) as { qrcode?: string; data?: string };
    const b64 = json.qrcode ?? json.data ?? "";
    return {
      qrImageDataUrl: b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`,
      referenceNo: params.referenceNo,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    qrImageDataUrl: `data:image/png;base64,${buf.toString("base64")}`,
    referenceNo: params.referenceNo,
  };
}

/**
 * Verify a charge server-to-server by our referenceNo.
 * Called from the webhook handler before crediting the wallet.
 */
export async function getChargeStatus(
  referenceNo: string,
  fetchImpl: FetchImpl = fetch
): Promise<ChargeStatusResult> {
  const { secretKey } = requireGbPrimePayKeys();
  const { baseUrl, successResultCode } = PAYMENTS_CONFIG.gbPrimePay;

  const res = await fetchImpl(`${baseUrl}/v1/check_status_txn`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(secretKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ referenceNo }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GB Prime Pay status check failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    resultCode?: string;
    gbpReferenceNo?: string;
    referenceNo?: string;
    amount?: number | string;
  };

  const resultCode = json.resultCode ?? null;
  const amount =
    json.amount === undefined || json.amount === null
      ? null
      : typeof json.amount === "string"
        ? parseFloat(json.amount)
        : json.amount;

  return {
    paid: resultCode === successResultCode,
    gatewayRef: json.gbpReferenceNo ?? null,
    resultCode,
    amountBaht: amount,
  };
}
