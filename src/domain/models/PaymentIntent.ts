import { PaymentGateway, PaymentMethod, PaymentStatus } from "@/domain/enums/PaymentStatus";

/**
 * A tracked, auditable top-up attempt.
 *
 * Created when a user requests a PromptPay QR; settled (or expired/failed) later.
 * `referenceNo` is our own unique id sent to the gateway; `gatewayRef` is the
 * gateway's id returned on the callback. Both are used for idempotent settlement
 * so a re-delivered webhook can never double-credit a wallet.
 *
 * PostgreSQL → `payment_intents` table.
 */
export interface PaymentIntent {
  id: string;
  userId: string;
  gateway: PaymentGateway;
  method: PaymentMethod;
  /** Amount to charge, in baht. */
  amountBaht: number;
  /** Credits to grant on success (1:1 with baht). */
  creditsToAdd: number;
  status: PaymentStatus;
  /** Our unique reference sent to the gateway (idempotency key). */
  referenceNo: string;
  /** Gateway's own reference, populated on callback. */
  gatewayRef: string | null;
  /** Raw QR payload / image data URL returned by the gateway (for display). */
  qrPayload: string | null;
  /** When the QR / intent stops being payable. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePaymentIntentInput = {
  userId: string;
  gateway: PaymentGateway;
  method: PaymentMethod;
  amountBaht: number;
  creditsToAdd: number;
  referenceNo: string;
  qrPayload?: string | null;
  expiresAt: Date;
};
