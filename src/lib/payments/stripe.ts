import Stripe from "stripe";
import {
  requireStripeSecretKey,
  requireStripeWebhookSecret,
} from "@/config/payments";

export interface PromptPayQrResult {
  qrImageDataUrl: string;
  referenceNo: string;
  gatewayRef: string;
  /**
   * False when the Stripe key is a test key. Test-mode PromptPay QRs encode a
   * Stripe simulation URL (open with the phone CAMERA app → "Authorize test
   * payment" page) — real Thai bank apps cannot scan them. The UI must tell
   * the user this, or the QR looks broken.
   */
  livemode: boolean;
  /** Stripe-hosted page with the QR + payment instructions (works in test mode too). */
  hostedInstructionsUrl?: string;
}

export interface CardCheckoutResult {
  checkoutUrl: string;
  gatewayRef: string;
}

export interface ChargeStatusResult {
  paid: boolean;
  failed: boolean;
  gatewayRef: string;
  resultCode: string;
  amountBaht: number;
  currency: string;
  referenceNo: string | null;
}

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!client) client = new Stripe(requireStripeSecretKey());
  return client;
}

export async function createPromptPayQr(params: {
  amountBaht: number;
  referenceNo: string;
  detail: string;
  customerEmail: string;
  userId?: string;
  creditsToAdd?: number;
}): Promise<PromptPayQrResult> {
  const paymentIntent = await getStripeClient().paymentIntents.create(
    {
      amount: Math.round(params.amountBaht * 100),
      currency: "thb",
      payment_method_types: ["promptpay"],
      payment_method_data: {
        type: "promptpay",
        billing_details: { email: params.customerEmail },
      },
      confirm: true,
      description: params.detail,
      metadata: {
        referenceNo: params.referenceNo,
        userId: params.userId ?? "",
        creditsToAdd: String(params.creditsToAdd ?? ""),
      },
    },
    { idempotencyKey: params.referenceNo }
  );

  const qr = paymentIntent.next_action?.promptpay_display_qr_code;
  if (!qr?.image_url_png) {
    throw new Error(`Stripe did not return a PromptPay QR (status: ${paymentIntent.status}).`);
  }

  return {
    qrImageDataUrl: qr.image_url_png,
    referenceNo: params.referenceNo,
    gatewayRef: paymentIntent.id,
    livemode: paymentIntent.livemode,
    hostedInstructionsUrl: qr.hosted_instructions_url ?? undefined,
  };
}

export async function createCardCheckout(params: {
  amountBaht: number;
  referenceNo: string;
  detail: string;
  userId: string;
  creditsToAdd: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<CardCheckoutResult> {
  const session = await getStripeClient().checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "thb",
          unit_amount: Math.round(params.amountBaht * 100),
          product_data: { name: `${params.creditsToAdd} Credit Top up` },
        },
      }],
      client_reference_id: params.referenceNo,
      metadata: {
        referenceNo: params.referenceNo,
        userId: params.userId,
        creditsToAdd: String(params.creditsToAdd),
      },
      payment_intent_data: {
        description: params.detail,
        metadata: {
          referenceNo: params.referenceNo,
          userId: params.userId,
          creditsToAdd: String(params.creditsToAdd),
        },
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
    { idempotencyKey: params.referenceNo }
  );
  if (!session.url) throw new Error("Stripe did not return a card checkout URL.");
  return { checkoutUrl: session.url, gatewayRef: session.id };
}

export function toChargeStatus(paymentIntent: Stripe.PaymentIntent): ChargeStatusResult {
  return {
    paid: paymentIntent.status === "succeeded",
    failed: paymentIntent.status === "canceled" || paymentIntent.status === "requires_payment_method",
    gatewayRef: paymentIntent.id,
    resultCode: paymentIntent.status,
    amountBaht: paymentIntent.amount_received / 100,
    currency: paymentIntent.currency,
    referenceNo: paymentIntent.metadata.referenceNo ?? null,
  };
}

export async function getChargeStatus(gatewayRef: string): Promise<ChargeStatusResult> {
  if (gatewayRef.startsWith("cs_")) {
    const session = await getStripeClient().checkout.sessions.retrieve(gatewayRef);
    return {
      paid: session.payment_status === "paid",
      failed: session.status === "expired",
      gatewayRef: session.id,
      resultCode: session.payment_status,
      amountBaht: (session.amount_total ?? 0) / 100,
      currency: session.currency ?? "",
      referenceNo:
        session.metadata?.referenceNo ?? session.client_reference_id ?? null,
    };
  }
  return toChargeStatus(await getStripeClient().paymentIntents.retrieve(gatewayRef));
}

export function constructStripeEvent(rawBody: string, signature: string): Stripe.Event {
  return getStripeClient().webhooks.constructEvent(
    rawBody,
    signature,
    requireStripeWebhookSecret()
  );
}
