/**
 * The RClipper Management products.
 *
 * All are ONE-TIME purchases paid for with credits. None renews, and none can
 * charge a user again.
 *
 * PAYMENT HAPPENS AT PUBLISH TIME. Getting content into Management — by
 * transferring a finished generation project, or by uploading your own video —
 * is free. These products unlock the act of publishing to social channels.
 *
 *   management_single_video     — a small consumable bundle of upload tokens.
 *                                 One token = one video to one channel.
 *   management_access_1_month   — unlimited publishing for 1 calendar month.
 *   management_access_3_months  — 3 calendar months.
 *   management_access_6_months  — 6 calendar months.
 *   management_access_1_year    — 12 calendar months.
 *
 * BUNDLES combine a publishing pass with a video-generation allowance in ONE
 * purchase and ONE credit debit. They are modelled as Management products
 * rather than video packages because `management_access_passes.purchase_id` is
 * a NOT NULL foreign key to `management_purchases` — a pass cannot exist
 * without a Management purchase row, while `video_allowance_windows.purchase_id`
 * is plain TEXT and happily accepts that same purchase id. Buying a bundle
 * therefore grants both entitlements inside the one transaction that debits the
 * wallet, so a crash can never leave a user holding half of what they paid for.
 *
 *   management_bundle_1_month   — 1 month of publishing + 1 month of videos.
 *   management_bundle_3_months  — 3 months of both.
 *   management_bundle_6_months  — 6 months of both.
 *   management_bundle_1_year    — 12 months of both.
 *
 * 2026-09-27: the bundles ARE the "Pro" packages (10 videos a month), and the
 * `management_starter_*` codes are the "Starter" packages (5 a month) — same
 * shape, a smaller video allowance. These eight are the only products sold;
 * the rest are retired and honoured until they expire (see config/management.ts).
 *
 *   management_starter_1_month  — 1 month of publishing + 5 videos a month.
 *   management_starter_3_months — 3 months.
 *   management_starter_6_months — 6 months.
 *   management_starter_1_year   — 12 months.
 */
export type ManagementProductCode =
  | "management_single_video"
  | "management_access_1_month"
  | "management_access_3_months"
  | "management_access_6_months"
  | "management_access_1_year"
  | "management_bundle_1_month"
  | "management_bundle_3_months"
  | "management_bundle_6_months"
  | "management_bundle_1_year"
  | "management_starter_1_month"
  | "management_starter_3_months"
  | "management_starter_6_months"
  | "management_starter_1_year";

export const MANAGEMENT_PRODUCT_CODES: readonly ManagementProductCode[] = [
  "management_single_video",
  "management_access_1_month",
  "management_access_3_months",
  "management_access_6_months",
  "management_access_1_year",
  "management_bundle_1_month",
  "management_bundle_3_months",
  "management_bundle_6_months",
  "management_bundle_1_year",
  "management_starter_1_month",
  "management_starter_3_months",
  "management_starter_6_months",
  "management_starter_1_year",
] as const;

export function isManagementProductCode(value: unknown): value is ManagementProductCode {
  return (
    typeof value === "string" &&
    (MANAGEMENT_PRODUCT_CODES as readonly string[]).includes(value)
  );
}

/**
 * Maps a product code to the entitlement type it grants.
 *
 * A bundle maps to the SAME entitlement type as the access pass of equal
 * length: the entitlement type records how long publishing is authorised for,
 * and a bundle authorises publishing for exactly as long as its pass. The video
 * allowance a bundle also grants is tracked separately in
 * `video_allowance_windows` and has nothing to do with publish authorisation.
 */
export const PRODUCT_CODE_TO_ENTITLEMENT_TYPE = {
  management_single_video: "single_video",
  management_access_1_month: "one_month",
  management_access_3_months: "three_months",
  management_access_6_months: "six_months",
  management_access_1_year: "one_year",
  management_bundle_1_month: "one_month",
  management_bundle_3_months: "three_months",
  management_bundle_6_months: "six_months",
  management_bundle_1_year: "one_year",
  management_starter_1_month: "one_month",
  management_starter_3_months: "three_months",
  management_starter_6_months: "six_months",
  management_starter_1_year: "one_year",
} as const;

/** True when the code is one of the combined video + publishing bundles. */
export function isManagementBundleCode(code: ManagementProductCode): boolean {
  return code.startsWith("management_bundle_") || code.startsWith("management_starter_");
}
