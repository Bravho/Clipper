import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";

/**
 * A purchasable RClipper Management product.
 *
 * PostgreSQL → `management_products`.
 *
 * This row is the trusted price. A checkout request carries only a product
 * CODE; the amount, currency, duration and entitlement type are always read
 * from here, never from the client.
 *
 * `priceCredits` is denominated in credits, and 1 credit = ฿1, so it doubles as
 * the baht price for display and receipts.
 */
export interface ManagementProduct {
  id: string;
  code: ManagementProductCode;
  name: string;
  description: string;
  /**
   * "single_video" is the entry product: a consumable, expiring bundle of upload
   * tokens (see `uploadAllowance` / `accessWindowDays`); "access_pass" grants
   * unlimited publishing for a calendar window. The legacy code name is kept for
   * schema/enum stability — the product is a small bundle, not a permanent unlock.
   */
  productType: "single_video" | "access_pass";
  /** Calendar months granted. null for the entry bundle. */
  durationMonths: number | null;
  /**
   * Entry-bundle only: how many upload tokens one purchase buys (one token =
   * one video to one channel). null for access passes (unlimited publishing).
   */
  uploadAllowance: number | null;
  /**
   * Entry-bundle only: how many days from purchase the allowance may be spent.
   * null for access passes.
   */
  accessWindowDays: number | null;
  /** Effective charge, in credits (= ฿). */
  priceCredits: number;
  /** Undiscounted list price, for "was ฿X" display. */
  fullPriceCredits: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
