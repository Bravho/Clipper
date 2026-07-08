/**
 * PaymentService — orchestrates PromptPay top-ups via GB Prime Pay.
 *
 * Flow:
 *   createTopupIntent()  → creates a PaymentIntent + a PromptPay QR to display.
 *   settleFromWebhook()  → called by the gateway webhook; RE-VERIFIES the payment
 *                          server-to-server, then idempotently credits the wallet.
 *
 * Idempotency: a PaymentIntent already in `Paid` state is never credited twice.
 * `referenceNo` (our id) and `gatewayRef` (theirs) are both stored for audit.
 */
import { randomUUID } from "crypto";
import {
  paymentIntentRepository,
} from "@/repositories";
import { creditService } from "@/services/CreditService";
import { PaymentIntent } from "@/domain/models/PaymentIntent";
import {
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
} from "@/domain/enums/PaymentStatus";
import { PAYMENTS_CONFIG } from "@/config/payments";
import { createPromptPayQr, getChargeStatus } from "@/lib/payments/gbPrimePay";
import { IPaymentIntentRepository } from "@/repositories/interfaces/IPaymentIntentRepository";

export interface CreateTopupResult {
  intentId: string;
  referenceNo: string;
  amountBaht: number;
  creditsToAdd: number;
  qrImageDataUrl: string;
  expiresAt: Date;
}

export class PaymentService {
  constructor(
    private intents: IPaymentIntentRepository = paymentIntentRepository,
    private credits = creditService,
    // Injected gateway fns so the service is testable without the live API.
    private gateway = { createPromptPayQr, getChargeStatus }
  ) {}

  /**
   * Create a PromptPay top-up. `amountBaht === creditsToAdd` (1:1).
   */
  async createTopupIntent(
    userId: string,
    amountBaht: number
  ): Promise<CreateTopupResult> {
    if (!Number.isFinite(amountBaht) || amountBaht <= 0) {
      throw new Error("Top-up amount must be greater than 0.");
    }

    const referenceNo = `RC-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const creditsToAdd = Math.round(amountBaht); // 1 credit = 1 baht
    const expiresAt = new Date(
      Date.now() + PAYMENTS_CONFIG.intentTtlMinutes * 60 * 1000
    );

    const qr = await this.gateway.createPromptPayQr({
      amountBaht,
      referenceNo,
      detail: `RClipper credits x${creditsToAdd}`,
    });

    const intent = await this.intents.create({
      userId,
      gateway: PaymentGateway.GbPrimePay,
      method: PaymentMethod.PromptPayQr,
      amountBaht,
      creditsToAdd,
      referenceNo,
      qrPayload: qr.qrImageDataUrl,
      expiresAt,
    });

    return {
      intentId: intent.id,
      referenceNo,
      amountBaht,
      creditsToAdd,
      qrImageDataUrl: qr.qrImageDataUrl,
      expiresAt,
    };
  }

  /**
   * Settle a top-up from a gateway webhook callback.
   *
   * Returns the resolved intent. Safe to call multiple times for the same
   * referenceNo — only the first successful verification credits the wallet.
   */
  async settleFromWebhook(referenceNo: string): Promise<PaymentIntent> {
    const intent = await this.intents.findByReferenceNo(referenceNo);
    if (!intent) throw new Error("Unknown payment reference.");

    // Idempotency: already settled → no-op.
    if (intent.status === PaymentStatus.Paid) return intent;

    // Never trust the webhook body: verify server-to-server.
    const status = await this.gateway.getChargeStatus(referenceNo);

    if (!status.paid) {
      return this.intents.updateStatus(intent.id, PaymentStatus.Failed, {
        gatewayRef: status.gatewayRef,
      });
    }

    // Amount sanity check — never credit more than the intent authorised.
    if (status.amountBaht !== null && status.amountBaht !== intent.amountBaht) {
      return this.intents.updateStatus(intent.id, PaymentStatus.Failed, {
        gatewayRef: status.gatewayRef,
      });
    }

    // Credit the wallet, then mark Paid. If crediting throws, status stays
    // Pending and the webhook (or a manual retry) can settle it later.
    await this.credits.creditTopup(
      intent.userId,
      intent.creditsToAdd,
      intent.amountBaht,
      status.gatewayRef ?? referenceNo
    );

    return this.intents.updateStatus(intent.id, PaymentStatus.Paid, {
      gatewayRef: status.gatewayRef,
    });
  }

  async getIntent(id: string): Promise<PaymentIntent | null> {
    return this.intents.findById(id);
  }
}

export const paymentService = new PaymentService();
