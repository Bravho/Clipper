import { IPaymentIntentRepository } from "@/repositories/interfaces/IPaymentIntentRepository";
import { PaymentIntent, CreatePaymentIntentInput } from "@/domain/models/PaymentIntent";
import {
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
} from "@/domain/enums/PaymentStatus";
import { pool } from "@/lib/db";

function rowToPaymentIntent(row: Record<string, unknown>): PaymentIntent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    gateway: row.gateway as PaymentGateway,
    method: row.method as PaymentMethod,
    amountBaht: parseFloat((row.amount_baht as string) ?? "0"),
    creditsToAdd: row.credits_to_add as number,
    status: row.status as PaymentStatus,
    referenceNo: row.reference_no as string,
    gatewayRef: (row.gateway_ref as string) ?? null,
    qrPayload: (row.qr_payload as string) ?? null,
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresPaymentIntentRepository implements IPaymentIntentRepository {
  constructor(private db = pool) {}

  async create(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    const { rows } = await this.db.query(
      `INSERT INTO payment_intents
         (user_id, gateway, method, amount_baht, credits_to_add, status,
          reference_no, gateway_ref, qr_payload, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.userId,
        input.gateway,
        input.method,
        input.amountBaht,
        input.creditsToAdd,
        PaymentStatus.Pending,
        input.referenceNo,
        input.gatewayRef ?? null,
        input.qrPayload ?? null,
        input.expiresAt,
      ]
    );
    return rowToPaymentIntent(rows[0]);
  }

  async findById(id: string): Promise<PaymentIntent | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM payment_intents WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }

  async findByReferenceNo(referenceNo: string): Promise<PaymentIntent | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM payment_intents WHERE reference_no = $1",
      [referenceNo]
    );
    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }

  async findByGatewayRef(gatewayRef: string): Promise<PaymentIntent | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM payment_intents WHERE gateway_ref = $1",
      [gatewayRef]
    );
    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<PaymentIntent[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM payment_intents WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToPaymentIntent);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    fields?: { gatewayRef?: string | null; qrPayload?: string | null }
  ): Promise<PaymentIntent> {
    const { rows } = await this.db.query(
      `UPDATE payment_intents
         SET status = $2,
             gateway_ref = COALESCE($3, gateway_ref),
             qr_payload = COALESCE($4, qr_payload),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, fields?.gatewayRef ?? null, fields?.qrPayload ?? null]
    );
    if (!rows[0]) throw new Error("Payment intent not found.");
    return rowToPaymentIntent(rows[0]);
  }

  async markPaidIfPending(
    id: string,
    fields?: { gatewayRef?: string | null }
  ): Promise<PaymentIntent | null> {
    // Conditional, atomic transition: the WHERE status = 'pending' clause means
    // only ONE concurrent caller can flip the row to Paid; the loser gets zero
    // rows back and must not credit.
    const { rows } = await this.db.query(
      `UPDATE payment_intents
         SET status = $2,
             gateway_ref = COALESCE($3, gateway_ref),
             updated_at = NOW()
       WHERE id = $1 AND status = $4
       RETURNING *`,
      [id, PaymentStatus.Paid, fields?.gatewayRef ?? null, PaymentStatus.Pending]
    );
    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }
}
