/**
 * RClipper Management — feature flag and trusted product configuration.
 *
 * WHAT IS FREE AND WHAT COSTS MONEY
 *   Free:  getting content in. Transferring a completed generation project is
 *          free and entirely optional, and uploading your own video is free.
 *          Users can collect, organise and preview at no cost.
 *   Paid:  publishing. Money is required immediately before a video is actually
 *          submitted to social channels — never before.
 *
 * PAYMENT MODEL: paid for with CREDITS, exactly like a clip request. Credits
 * are topped up through the existing, already-verified rails — Stripe
 * PromptPay/Card on web (settled by a signed webhook) and Apple In-App Purchase
 * / Google Play Billing in the native shells (settled by server-side receipt
 * verification). Spending those credits on a Management package is a wallet
 * debit, so:
 *
 *   * there is no new payment provider, price object, or webhook;
 *   * store policy is satisfied everywhere, because in-app money always enters
 *     through the platform's own billing (see docs/MOBILE_STORE_COMPLIANCE.md);
 *   * every purchase is a ONE-TIME debit. There is no subscription object, no
 *     renewal timer, and nothing that can charge a user again. When an access
 *     pass expires, nothing happens except that new transfers and new
 *     publications stop being allowed.
 *
 * Credit unit: 1 credit = ฿1 (see src/config/credits.ts).
 *
 * PRICING: the four amounts below are the *launch* (50 % off) prices confirmed
 * for the first release. They follow the same shape as CREDITS_CONFIG — a full
 * list price, a discounted launch price, and a single flag that switches
 * between them — so the promotion can be ended by flipping one boolean rather
 * than editing prices in several places.
 */

import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";

/** When true, Management packages are charged at their launch (50 % off) price. */
export const MANAGEMENT_LAUNCH_DISCOUNT_ACTIVE = true;

/**
 * How long a PAID Management video is kept before being purged, in days.
 *
 * The RECORD and any paid unlock last indefinitely; the FILE does not. Paying
 * relocates the media into `management_retained/`, whose DigitalOcean Spaces
 * lifecycle rule enforces this window (the bucket rule adds a safety day). Both
 * paid Management paths — self-uploads (ManagementUploadRetentionService) and
 * transferred generation videos (ManagementTransferRetentionService) — use this
 * single window, so it is defined once here to keep them from drifting. It reads
 * the same env var the retention services read (`RCLIPPER_MANAGEMENT_UPLOAD_
 * RETAINED_DAYS`, default 30).
 *
 * There is no longer a separate, longer "media retention" window: RClipper
 * Management does not schedule posts ahead, so nothing needs to outlive the
 * 30-day paid window.
 */
export function managementRetainedDays(): number {
  return Math.max(
    1,
    Number(process.env.RCLIPPER_MANAGEMENT_UPLOAD_RETAINED_DAYS ?? "30")
  );
}

/** The purge date for paid Management media created now. */
export function managementRetainedExpiryFrom(from: Date = new Date()): Date {
  return new Date(from.getTime() + managementRetainedDays() * 86_400_000);
}

export interface ManagementProductDefinition {
  code: ManagementProductCode;
  /** i18n key for the display name. */
  nameKey: string;
  /** i18n key for the short description. */
  descriptionKey: string;
  /**
   * "single_video" is the entry product: a CONSUMABLE, EXPIRING bundle of upload
   * tokens (see `uploadAllowance` / `accessWindowDays`). One token is spent per
   * video published to one channel. "access_pass" grants UNLIMITED publishing for
   * a time window (no token counting).
   *
   * NOTE the legacy code name `management_single_video` is kept for schema/enum
   * stability; the product is a small bundle, not a permanent single-video unlock.
   */
  productType: "single_video" | "access_pass";
  /** Calendar months of access. null for the entry bundle. */
  durationMonths: number | null;
  /**
   * Entry-bundle only: how many uploads (video → one channel) one purchase buys.
   * Each publication target consumes one. null for access passes (unlimited).
   */
  uploadAllowance: number | null;
  /**
   * Entry-bundle only: how many days from purchase the allowance may be spent.
   * This is NEITHER how long a post stays up NOR the media-storage window — only
   * the window to use the tokens. null for access passes.
   */
  accessWindowDays: number | null;
  /** Full list price, in credits (= ฿). */
  fullPriceCredits: number;
  /** Discounted launch price, in credits (= ฿). */
  launchPriceCredits: number;
  /** Display order in the package picker. */
  sortOrder: number;
}

/**
 * The trusted product catalogue.
 *
 * This is the SERVER-SIDE source of truth mirrored into the `management_products`
 * table by migration 019. Nothing the client sends is ever used to determine a
 * price, a duration, or an entitlement type — the client sends a product CODE
 * and nothing else, and the backend resolves everything from here / the DB.
 */
export const MANAGEMENT_PRODUCTS: readonly ManagementProductDefinition[] = [
  {
    code: "management_single_video",
    nameKey: "management.product.singleVideo.name",
    descriptionKey: "management.product.singleVideo.description",
    productType: "single_video",
    durationMonths: null,
    // 50 credits → 4 uploads, usable within 30 days. One upload = one video to
    // one channel; the same file to three channels spends three tokens.
    uploadAllowance: 4,
    accessWindowDays: 30,
    fullPriceCredits: 100,
    launchPriceCredits: 50,
    sortOrder: 1,
  },
  {
    code: "management_access_3_months",
    nameKey: "management.product.access3Months.name",
    descriptionKey: "management.product.access3Months.description",
    productType: "access_pass",
    durationMonths: 3,
    uploadAllowance: null,
    accessWindowDays: null,
    fullPriceCredits: 600,
    launchPriceCredits: 300,
    sortOrder: 2,
  },
  {
    code: "management_access_6_months",
    nameKey: "management.product.access6Months.name",
    descriptionKey: "management.product.access6Months.description",
    productType: "access_pass",
    durationMonths: 6,
    uploadAllowance: null,
    accessWindowDays: null,
    fullPriceCredits: 1100,
    launchPriceCredits: 550,
    sortOrder: 3,
  },
  {
    code: "management_access_1_year",
    nameKey: "management.product.access1Year.name",
    descriptionKey: "management.product.access1Year.description",
    productType: "access_pass",
    durationMonths: 12,
    uploadAllowance: null,
    accessWindowDays: null,
    fullPriceCredits: 2000,
    launchPriceCredits: 1000,
    sortOrder: 4,
  },
] as const;

/**
 * The bundle terms for a product, or null when it is an access pass.
 *
 * A single home for "how many uploads and for how long", so the purchase grant,
 * the entitlement check and the UI all read the same numbers.
 */
export function managementBundleTerms(
  product: ManagementProductDefinition
): { uploadAllowance: number; accessWindowDays: number } | null {
  if (product.uploadAllowance == null || product.accessWindowDays == null) return null;
  return {
    uploadAllowance: product.uploadAllowance,
    accessWindowDays: product.accessWindowDays,
  };
}

/** Effective price charged for a product, in credits. */
export function managementPriceCredits(product: ManagementProductDefinition): number {
  return MANAGEMENT_LAUNCH_DISCOUNT_ACTIVE
    ? product.launchPriceCredits
    : product.fullPriceCredits;
}

/** Look up a product definition by code. Returns null for an unknown code. */
export function findManagementProduct(
  code: string
): ManagementProductDefinition | null {
  return MANAGEMENT_PRODUCTS.find((p) => p.code === code) ?? null;
}

/**
 * Social platforms a Management user may currently CONNECT.
 *
 * This is a UI allowlist only — it hides not-yet-enabled platforms from the
 * "add account" grid without removing them from `SOCIAL_PLATFORMS` (which the
 * aspect-ratio rules and the publish path still key off). Override with a
 * comma-separated env list to enable more as they are ready.
 */
export function managementConnectablePlatforms(): string[] {
  const raw = process.env.RCLIPPER_MANAGEMENT_CONNECTABLE_PLATFORMS;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  // Enabled for now: Facebook, Instagram, YouTube, TikTok (not TikTok Business).
  return ["facebook", "instagram", "youtube", "tiktok"];
}

// ── Feature flag ─────────────────────────────────────────────────────────────

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Rollout configuration, read from the environment ON EACH ACCESS.
 *
 * Every field is a getter rather than a captured value. Reading at call time
 * means the flag can be flipped without a code change taking a rebuild to
 * observe, and — importantly — that the flag is testable: a module-scope
 * constant would be frozen at import time, before any test could set the env
 * var, because ES imports are hoisted above statements.
 */
export const MANAGEMENT_CONFIG = {
  /**
   * Master switch. Default ON — the feature is enabled everywhere without any
   * env var being set. A single escape hatch remains: setting
   * RCLIPPER_MANAGEMENT_ENABLED="false" turns it off instantly (no code change,
   * no redeploy), which is the emergency rollback for a feature that touches
   * money and third-party publishing. Any other value, or none, means ON.
   */
  get enabled(): boolean {
    return process.env.RCLIPPER_MANAGEMENT_ENABLED !== "false";
  },

  /** Admins always see the module when the master switch is on. */
  adminsAlwaysAllowed: true,

  /** Explicit email allowlist for staged rollout. */
  get allowedEmails(): string[] {
    return parseList(process.env.RCLIPPER_MANAGEMENT_ALLOWED_EMAILS);
  },

  /** Email-domain allowlist, e.g. "rclipper.com,travy.app". */
  get allowedEmailDomains(): string[] {
    return parseList(process.env.RCLIPPER_MANAGEMENT_ALLOWED_DOMAINS);
  },

  /** Explicit user-id allowlist. */
  get allowedUserIds(): string[] {
    return parseList(process.env.RCLIPPER_MANAGEMENT_ALLOWED_USER_IDS);
  },

  /** Percentage rollout, 0–100, bucketed deterministically by user id. */
  get rolloutPercent(): number {
    return Math.min(
      100,
      Math.max(0, Number(process.env.RCLIPPER_MANAGEMENT_ROLLOUT_PERCENT ?? "100"))
    );
  },
} as const;

/**
 * Deterministic 0–99 bucket for a user id (FNV-1a). Stable across processes and
 * restarts, so a user does not flip in and out of the rollout between requests.
 */
function rolloutBucket(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Server-side flag evaluation. The frontend never decides this — it receives
 * the already-evaluated answer, and every API route re-evaluates it.
 */
export function isManagementEnabledFor(user: {
  id: string;
  email?: string | null;
  role?: string | null;
}): boolean {
  if (!MANAGEMENT_CONFIG.enabled) return false;

  if (MANAGEMENT_CONFIG.adminsAlwaysAllowed && user.role === "admin") return true;

  const email = (user.email ?? "").toLowerCase();
  const allowedEmails = MANAGEMENT_CONFIG.allowedEmails;
  if (email && allowedEmails.includes(email)) return true;

  const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
  const allowedDomains = MANAGEMENT_CONFIG.allowedEmailDomains;
  if (domain && allowedDomains.includes(domain)) return true;

  const allowedUserIds = MANAGEMENT_CONFIG.allowedUserIds;
  if (allowedUserIds.includes(user.id.toLowerCase())) return true;

  // An explicit allowlist that matched nothing should not silently fall through
  // to a 100 % rollout, so only apply the percentage when no list is configured.
  const hasAllowlist =
    allowedEmails.length > 0 || allowedDomains.length > 0 || allowedUserIds.length > 0;
  if (hasAllowlist) return false;

  return rolloutBucket(user.id) < MANAGEMENT_CONFIG.rolloutPercent;
}

// ── Post for Me (server-only) ────────────────────────────────────────────────

/**
 * Post for Me credentials. SERVER ONLY — deliberately not prefixed with
 * NEXT_PUBLIC_, never returned by an API route, never logged.
 *
 * Every field is a GETTER, read on each access rather than captured at import
 * time. Two reasons, both operational:
 *
 *   * Module-scope capture depends on import order. If this module were
 *     evaluated before the environment is fully populated (see
 *     scripts/bootstrapEnv.ts), the API key and webhook secret would be
 *     permanently empty for the life of the process — and the failure would
 *     look like "the provider rejects everything" rather than "config missing".
 *   * It makes the values testable and changeable without a rebuild.
 */
export const POST_FOR_ME_CONFIG = {
  get apiKey(): string {
    return (process.env.POST_FOR_ME_API_KEY ?? "").trim();
  },
  get baseUrl(): string {
    return (process.env.POST_FOR_ME_BASE_URL ?? "https://api.postforme.dev").trim();
  },
  get webhookSecret(): string {
    return (process.env.POST_FOR_ME_WEBHOOK_SECRET ?? "").trim();
  },
  /** "quickstart" uses Post for Me's app credentials; "white_label" uses ours. */
  get projectType(): string {
    return (process.env.POST_FOR_ME_PROJECT_TYPE ?? "quickstart").trim();
  },
  get environment(): string {
    return (process.env.POST_FOR_ME_ENVIRONMENT ?? "development").trim();
  },
  get requestTimeoutMs(): number {
    return Number(process.env.POST_FOR_ME_TIMEOUT_MS ?? "20000");
  },
} as const;

export function requirePostForMeApiKey(): string {
  const key = POST_FOR_ME_CONFIG.apiKey;
  if (!key) {
    throw new Error(
      "Post for Me is not configured. Add POST_FOR_ME_API_KEY to the server environment."
    );
  }
  return key;
}

export function requirePostForMeWebhookSecret(): string {
  const secret = POST_FOR_ME_CONFIG.webhookSecret;
  if (!secret) {
    throw new Error(
      "Post for Me webhooks are not configured. Add POST_FOR_ME_WEBHOOK_SECRET to the server environment."
    );
  }
  return secret;
}
