import { PaymentIntent, CreatePaymentIntentInput } from "@/domain/models/PaymentIntent";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

export interface IPaymentIntentRepository {
  create(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
  findById(id: string): Promise<PaymentIntent | null>;
  findByReferenceNo(referenceNo: string): Promise<PaymentIntent | null>;
  findByGatewayRef(gatewayRef: string): Promise<PaymentIntent | null>;
  findByUserId(userId: string): Promise<PaymentIntent[]>;
  /**
   * Update status (and optionally gateway ref / qr payload).
   * Implementations must set updatedAt.
   */
  updateStatus(
    id: string,
    status: PaymentStatus,
    fields?: { gatewayRef?: string | null; qrPayload?: string | null }
  ): Promise<PaymentIntent>;
  /**
   * Atomically transition an intent from Pending → Paid, but ONLY if it is still
   * Pending. Returns the updated intent when this caller won the transition, or
   * null when the intent was already non-Pending (someone else settled it first).
   *
   * This is the concurrency guard that lets the webhook and the poll-side
   * backstop both attempt settlement without ever double-crediting a wallet:
   * only the caller that flips Pending→Paid proceeds to credit.
   */
  markPaidIfPending(
    id: string,
    fields?: { gatewayRef?: string | null }
  ): Promise<PaymentIntent | null>;
}
