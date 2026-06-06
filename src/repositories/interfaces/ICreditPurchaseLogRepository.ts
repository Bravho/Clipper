import { CreditPurchaseLog, CreateCreditPurchaseLogInput } from "@/domain/models/CreditPurchaseLog";

export interface ICreditPurchaseLogRepository {
  create(input: CreateCreditPurchaseLogInput): Promise<CreditPurchaseLog>;
  findByUserId(userId: string): Promise<CreditPurchaseLog[]>;
  listAll(): Promise<CreditPurchaseLog[]>;
}
