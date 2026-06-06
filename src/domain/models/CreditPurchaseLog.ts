export interface CreditPurchaseLog {
  id: string;
  userId: string;
  creditsAdded: number;
  amountBaht: number;
  transactionRef: string | null;
  createdAt: Date;
}

export type CreateCreditPurchaseLogInput = {
  userId: string;
  creditsAdded: number;
  amountBaht: number;
  transactionRef?: string | null;
};
