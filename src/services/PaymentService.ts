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
  /**
   * Per-intent timestamp of the last poll-side gateway verification, so the
   * backstop is throttled (see `pollBackstopThrottleMs`). Static/in-process:
   * the app runs as a single PM2 fork, so a module-level map is shared across
   * requests and resets harmlessly on restart (worst case: one extra gateway
   * call per intent right after a restart).
   */
  private static _lastGatewayPoll = new Map<string, number>();

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
   * referenceNo — the atomic Pending→Paid claim means only one caller ever
   * credits the wallet, even if the webhook and the poll backstop race.
   *
   * Webhook semantics: the webhook only fires AFTER a payment attempt, so a
   * gateway "not paid" here is a genuine failure and the intent is marked Failed.
   */
  async settleFromWebhook(referenceNo: string): Promise<PaymentIntent> {
    const intent = await this.intents.findByReferenceNo(referenceNo);
    if (!intent) throw new Error("Unknown payment reference.");

    // Only a still-Pending intent is actionable (Paid/Failed/Expired are terminal).
    if (intent.status !== PaymentStatus.Pending) return intent;

    return this._verifyAndSettle(intent, referenceNo, { failIfNotPaid: true });
  }

  /**
   * Poll-side settlement backstop for the status endpoint.
   *
   * Returns the intent's status for the UI. While the intent is still Pending it
   * re-verifies against the gateway — but only when a payment is truly settled
   * does it credit; a "not paid yet" leaves the intent Pending (unlike the
   * webhook, polling happens continuously BEFORE the customer pays, so it must
   * never mark Failed). This makes settlement resilient to a missed/undelivered
   * webhook. Gateway calls are throttled per-intent to avoid hammering the API.
   *
   * Wall-clock expiry is REPORTED (so the UI can stop), but NOT persisted — the
   * intent stays Pending in the DB so a late-but-real payment can still settle.
   */
  async pollIntentStatus(
    intentId: string,
    userId: string
  ): Promise<{ status: PaymentStatus } | null> {
    let intent = await this.intents.findById(intentId);
    if (!intent || intent.userId !== userId) return null;

    if (intent.status === PaymentStatus.Pending && this._shouldPollGateway(intentId)) {
      this._markGatewayPolled(intentId);
      try {
        intent = await this._verifyAndSettle(intent, intent.referenceNo, {
          failIfNotPaid: false,
        });
      } catch (err) {
        // The backstop must never break the poll — log and fall back to the
        // last-known status; the next poll (or the webhook) can still settle it.
        console.error("[poll backstop] gateway verification failed:", err);
        intent = (await this.intents.findById(intentId)) ?? intent;
      }
    }

    let status = intent.status;
    if (
      status === PaymentStatus.Pending &&
      intent.expiresAt.getTime() < Date.now()
    ) {
      status = PaymentStatus.Expired;
    }
    return { status };
  }

  async getIntent(id: string): Promise<PaymentIntent | null> {
    return this.intents.findById(id);
  }

  // ── Internal settlement helpers ────────────────────────────────────────────

  /**
   * Verify a Pending intent against the gateway and settle it on success. Shared
   * by the webhook and the poll backstop; `failIfNotPaid` diverges the "not paid"
   * branch (webhook → Failed, poll → leave Pending).
   */
  private async _verifyAndSettle(
    intent: PaymentIntent,
    referenceNo: string,
    opts: { failIfNotPaid: boolean }
  ): Promise<PaymentIntent> {
    const status = await this.gateway.getChargeStatus(referenceNo);

    if (!status.paid) {
      if (opts.failIfNotPaid) {
        return this.intents.updateStatus(intent.id, PaymentStatus.Failed, {
          gatewayRef: status.gatewayRef,
        });
      }
      return intent; // still awaiting payment — keep Pending
    }

    // Amount sanity check — never credit more than the intent authorised.
    if (status.amountBaht !== null && status.amountBaht !== intent.amountBaht) {
      return this.intents.updateStatus(intent.id, PaymentStatus.Failed, {
        gatewayRef: status.gatewayRef,
      });
    }

    return this._creditClaimedIntent(intent, status.gatewayRef ?? referenceNo);
  }

  /**
   * Atomically claim the Pending→Paid transition, then credit the wallet. Only
   * the caller that wins the claim credits, so concurrent webhook + poll can
   * never double-credit. If crediting throws, the claim is rolled back to Pending
   * so a later attempt can retry.
   */
  private async _creditClaimedIntent(
    intent: PaymentIntent,
    gatewayRef: string
  ): Promise<PaymentIntent> {
    const claimed = await this.intents.markPaidIfPending(intent.id, { gatewayRef });
    if (!claimed) {
      // Lost the race — another path already settled it. Return current state.
      return (await this.intents.findById(intent.id)) ?? intent;
    }

    try {
      await this.credits.creditTopup(
        intent.userId,
        intent.creditsToAdd,
        intent.amountBaht,
        gatewayRef
      );
    } catch (err) {
      // Roll the claim back so the credit can be retried by a later webhook/poll.
      await this.intents
        .updateStatus(intent.id, PaymentStatus.Pending)
        .catch(() => undefined);
      throw err;
    }

    return claimed;
  }

  /** Per-intent throttle for the poll-side gateway backstop (in-process). */
  private _shouldPollGateway(intentId: string): boolean {
    const last = PaymentService._lastGatewayPoll.get(intentId);
    return (
      last === undefined ||
      Date.now() - last >= PAYMENTS_CONFIG.pollBackstopThrottleMs
    );
  }

  private _markGatewayPolled(intentId: string): void {
    PaymentService._lastGatewayPoll.set(intentId, Date.now());
    // Opportunistic cleanup so the map can't grow unbounded across many intents.
    if (PaymentService._lastGatewayPoll.size > 5000) {
      const cutoff = Date.now() - 10 * PAYMENTS_CONFIG.pollBackstopThrottleMs;
      for (const [k, t] of PaymentService._lastGatewayPoll) {
        if (t < cutoff) PaymentService._lastGatewayPoll.delete(k);
      }
    }
  }
}

export const paymentService = new PaymentService();
