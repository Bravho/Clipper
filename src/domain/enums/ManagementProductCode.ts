/**
 * The four RClipper Management products.
 *
 * All are ONE-TIME purchases paid for with credits. None renews, and none can
 * charge a user again.
 *
 * PAYMENT HAPPENS AT PUBLISH TIME. Getting content into Management — by
 * transferring a finished generation project, or by uploading your own video —
 * is free. These products unlock the act of publishing to social channels.
 *
 *   management_single_video     — unlocks ONE content item for publishing,
 *                                 permanently. Re-publishing, adding channels
 *                                 later and retrying a failure all cost nothing
 *                                 further. The unlock outlives the stored media.
 *   management_access_3_months  — unlimited publishing for 3 calendar months.
 *   management_access_6_months  — 6 calendar months.
 *   management_access_1_year    — 12 calendar months.
 */
export type ManagementProductCode =
  | "management_single_video"
  | "management_access_3_months"
  | "management_access_6_months"
  | "management_access_1_year";

export const MANAGEMENT_PRODUCT_CODES: readonly ManagementProductCode[] = [
  "management_single_video",
  "management_access_3_months",
  "management_access_6_months",
  "management_access_1_year",
] as const;

export function isManagementProductCode(value: unknown): value is ManagementProductCode {
  return (
    typeof value === "string" &&
    (MANAGEMENT_PRODUCT_CODES as readonly string[]).includes(value)
  );
}

/** Maps a product code to the entitlement type it grants. */
export const PRODUCT_CODE_TO_ENTITLEMENT_TYPE = {
  management_single_video: "single_video",
  management_access_3_months: "three_months",
  management_access_6_months: "six_months",
  management_access_1_year: "one_year",
} as const;
