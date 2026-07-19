import { SignJWT, importPKCS8 } from "jose";
import { pool } from "@/lib/db";
import { creditsForStoreProduct } from "@/config/mobilePurchases";

type StorePlatform = "ios" | "android";

interface VerifiedPurchase {
  productId: string;
  transactionId: string;
  environment: string;
  purchasedAt: Date | null;
}

function decodeJwsPayload<T>(jws: string): T {
  const payload = jws.split(".")[1];
  if (!payload) throw new Error("Store returned an invalid signed transaction.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
}

async function appleAuthorization(): Promise<string> {
  const issuerId = process.env.APP_STORE_ISSUER_ID?.trim();
  const keyId = process.env.APP_STORE_KEY_ID?.trim();
  const bundleId = process.env.APP_STORE_BUNDLE_ID?.trim() || "com.rclipper.app";
  const privateKey = process.env.APP_STORE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!issuerId || !keyId || !privateKey) {
    throw new Error("App Store server credentials are not configured.");
  }
  const key = await importPKCS8(privateKey, "ES256");
  return new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuerId)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

async function verifyApple(transactionId: string): Promise<VerifiedPurchase> {
  if (!/^\d+$/.test(transactionId)) throw new Error("Invalid App Store transaction.");
  const authorization = await appleAuthorization();
  const environments = [
    { name: "Production", host: "https://api.storekit.itunes.apple.com" },
    { name: "Sandbox", host: "https://api.storekit-sandbox.itunes.apple.com" },
  ] as const;

  for (const environment of environments) {
    const response = await fetch(
      `${environment.host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${authorization}` } }
    );
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`App Store verification failed (${response.status}).`);
    const body = (await response.json()) as { signedTransactionInfo?: string };
    if (!body.signedTransactionInfo) throw new Error("App Store returned no transaction.");
    const transaction = decodeJwsPayload<{
      transactionId?: string;
      productId?: string;
      bundleId?: string;
      purchaseDate?: number;
      revocationDate?: number;
      environment?: string;
    }>(body.signedTransactionInfo);
    const expectedBundle = process.env.APP_STORE_BUNDLE_ID?.trim() || "com.rclipper.app";
    if (
      transaction.transactionId !== transactionId ||
      transaction.bundleId !== expectedBundle ||
      !transaction.productId ||
      transaction.revocationDate
    ) {
      throw new Error("App Store transaction is not eligible.");
    }
    return {
      productId: transaction.productId,
      transactionId,
      environment: transaction.environment || environment.name,
      purchasedAt: transaction.purchaseDate
        ? new Date(transaction.purchaseDate)
        : null,
    };
  }
  throw new Error("App Store transaction was not found.");
}

async function googleAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_PLAY_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PLAY_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    throw new Error("Google Play server credentials are not configured.");
  }
  const key = await importPKCS8(privateKey, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/androidpublisher",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google Play OAuth failed (${response.status}).`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Google Play returned no access token.");
  return body.access_token;
}

async function verifyGoogle(
  purchaseToken: string,
  claimedProductId: string
): Promise<VerifiedPurchase> {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "com.rclipper.app";
  const accessToken = await googleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(claimedProductId)}/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`Google Play verification failed (${response.status}).`);
  const purchase = (await response.json()) as {
    purchaseState?: number;
    consumptionState?: number;
    purchaseTimeMillis?: string;
    orderId?: string;
  };
  if (purchase.purchaseState !== 0) {
    throw new Error("Google Play purchase is not completed.");
  }
  return {
    productId: claimedProductId,
    transactionId: purchaseToken,
    environment: purchase.orderId?.startsWith("GPA.") ? "Production" : "Test",
    purchasedAt: purchase.purchaseTimeMillis
      ? new Date(Number(purchase.purchaseTimeMillis))
      : null,
  };
}

async function consumeGoogle(purchaseToken: string, productId: string): Promise<void> {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "com.rclipper.app";
  const accessToken = await googleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!response.ok && response.status !== 409) {
    throw new Error(`Google Play consumption failed (${response.status}).`);
  }
}

async function settleGooglePurchase(transactionId: string, productId: string): Promise<void> {
  try {
    await consumeGoogle(transactionId, productId);
  } catch (error) {
    // Credits are idempotently recorded first. A later client retry will attempt
    // consumption again without granting credits twice.
    console.error("[mobile-purchase] Google Play consumption deferred:", error);
  }
}

export class MobileStorePurchaseService {
  async verifyAndGrant(input: {
    userId: string;
    platform: StorePlatform;
    productId: string;
    transactionId: string;
  }): Promise<{ creditsGranted: number; alreadyProcessed: boolean }> {
    const expectedCredits = creditsForStoreProduct(input.productId);
    if (!expectedCredits) throw new Error("Unknown mobile store product.");

    const previouslyProcessed = await pool.query<{
      user_id: string;
      credits_granted: number;
    }>(
      `SELECT user_id, credits_granted
       FROM mobile_store_purchases
       WHERE platform = $1 AND transaction_id = $2`,
      [input.platform, input.transactionId]
    );
    if (previouslyProcessed.rows[0]) {
      if (previouslyProcessed.rows[0].user_id !== input.userId) {
        throw new Error("Store transaction belongs to another account.");
      }
      if (input.platform === "android") {
        await settleGooglePurchase(input.transactionId, input.productId);
      }
      return {
        creditsGranted: previouslyProcessed.rows[0].credits_granted,
        alreadyProcessed: true,
      };
    }

    const verified =
      input.platform === "ios"
        ? await verifyApple(input.transactionId)
        : await verifyGoogle(input.transactionId, input.productId);
    if (verified.productId !== input.productId) {
      throw new Error("Store product does not match the requested product.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{
        user_id: string;
        credits_granted: number;
      }>(
        `SELECT user_id, credits_granted FROM mobile_store_purchases
         WHERE platform = $1 AND transaction_id = $2`,
        [input.platform, verified.transactionId]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].user_id !== input.userId) {
          throw new Error("Store transaction belongs to another account.");
        }
        await client.query("COMMIT");
        if (input.platform === "android") {
          await settleGooglePurchase(input.transactionId, input.productId);
        }
        return {
          creditsGranted: existing.rows[0].credits_granted,
          alreadyProcessed: true,
        };
      }

      const wallet = await client.query<{ id: string }>(
        `INSERT INTO credit_wallets
           (user_id, balance, initial_credits_granted)
         VALUES ($1, 0, TRUE)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [input.userId]
      );
      await client.query(
        `INSERT INTO mobile_store_purchases
           (user_id, platform, product_id, transaction_id, credits_granted,
            store_environment, purchased_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.userId,
          input.platform,
          verified.productId,
          verified.transactionId,
          expectedCredits,
          verified.environment,
          verified.purchasedAt,
        ]
      );
      await client.query(
        `UPDATE credit_wallets
         SET balance = balance + $1, updated_at = NOW()
         WHERE id = $2`,
        [expectedCredits, wallet.rows[0].id]
      );
      await client.query(
        `INSERT INTO credit_transactions
           (user_id, amount, type, description, reference_id)
         VALUES ($1,$2,'top_up',$3,NULL)`,
        [
          input.userId,
          expectedCredits,
          `${input.platform === "ios" ? "App Store" : "Google Play"} purchase: ${verified.productId}`,
        ]
      );
      await client.query("COMMIT");
      if (input.platform === "android") {
        await settleGooglePurchase(verified.transactionId, verified.productId);
      }
      return { creditsGranted: expectedCredits, alreadyProcessed: false };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

export const mobileStorePurchaseService = new MobileStorePurchaseService();
