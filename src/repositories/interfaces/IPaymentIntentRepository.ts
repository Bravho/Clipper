import { PaymentIntent, CreatePaymentIntentInput } from "@/domain/models/PaymentIntent";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

export interface IPaymentIntentRepository {
  create(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
  findById(id: string): Promise<PaymentIntent | null>;
  findByReferenceNo(referenceNo: string): Promise<PaymentIntent | null>;
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
}
