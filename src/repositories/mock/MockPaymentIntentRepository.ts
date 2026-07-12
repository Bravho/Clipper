import { IPaymentIntentRepository } from "@/repositories/interfaces/IPaymentIntentRepository";
import { PaymentIntent, CreatePaymentIntentInput } from "@/domain/models/PaymentIntent";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

// TODO: PostgreSQL — replace with PostgresPaymentIntentRepository in production.

declare global {
  // eslint-disable-next-line no-var
  var __mockPaymentIntentStore: Map<string, PaymentIntent> | undefined;
}

function getStore(): Map<string, PaymentIntent> {
  if (!global.__mockPaymentIntentStore) {
    global.__mockPaymentIntentStore = new Map();
  }
  return global.__mockPaymentIntentStore;
}

export class MockPaymentIntentRepository implements IPaymentIntentRepository {
  private store: Map<string, PaymentIntent>;

  constructor(store?: Map<string, PaymentIntent>) {
    this.store = store ?? getStore();
  }

  async create(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    const now = new Date();
    const intent: PaymentIntent = {
      id: crypto.randomUUID(),
      userId: input.userId,
      gateway: input.gateway,
      method: input.method,
      amountBaht: input.amountBaht,
      creditsToAdd: input.creditsToAdd,
      status: PaymentStatus.Pending,
      referenceNo: input.referenceNo,
      gatewayRef: null,
      qrPayload: input.qrPayload ?? null,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(intent.id, intent);
    return { ...intent };
  }

  async findById(id: string): Promise<PaymentIntent | null> {
    const found = this.store.get(id);
    return found ? { ...found } : null;
  }

  async findByReferenceNo(referenceNo: string): Promise<PaymentIntent | null> {
    const found = [...this.store.values()].find((p) => p.referenceNo === referenceNo);
    return found ? { ...found } : null;
  }

  async findByUserId(userId: string): Promise<PaymentIntent[]> {
    return [...this.store.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => ({ ...p }));
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    fields?: { gatewayRef?: string | null; qrPayload?: string | null }
  ): Promise<PaymentIntent> {
    const existing = this.store.get(id);
    if (!existing) throw new Error("Payment intent not found.");
    const updated: PaymentIntent = {
      ...existing,
      status,
      gatewayRef: fields?.gatewayRef !== undefined ? fields.gatewayRef : existing.gatewayRef,
      qrPayload: fields?.qrPayload !== undefined ? fields.qrPayload : existing.qrPayload,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }

  async markPaidIfPending(
    id: string,
    fields?: { gatewayRef?: string | null }
  ): Promise<PaymentIntent | null> {
    const existing = this.store.get(id);
    // Only the caller that finds it still Pending wins the transition.
    if (!existing || existing.status !== PaymentStatus.Pending) return null;
    const updated: PaymentIntent = {
      ...existing,
      status: PaymentStatus.Paid,
      gatewayRef: fields?.gatewayRef !== undefined ? fields.gatewayRef : existing.gatewayRef,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }
}
