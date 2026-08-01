/**
 * ManagementConnectionService — linking a user's own social accounts.
 *
 * CONNECTING IS FREE. Like transferring and uploading, this costs nothing;
 * payment applies only when a video is published.
 *
 * THE SECURITY PROBLEM THIS SOLVES. The provider redirects the user back to our
 * callback with `accountIds` in the QUERY STRING, and no proof of who they are.
 * Taken at face value, anyone could hit the callback with somebody else's
 * account id and attach it to their own dashboard. Four defences, layered:
 *
 *   1. A signed, single-use, short-lived STATE token (JWT via `jose`) bound to
 *      {userId, platform, connectionId}. It rides on OUR redirect URL, which
 *      only exists on White Label projects — see `start()` for why it is never
 *      stapled onto the provider's own authorization URL.
 *   2. Every claimed account is RE-FETCHED from the provider server-to-server.
 *      The redirect's query string is treated as a hint, never as data.
 *   3. The re-fetched account's `external_id` must equal the session user's id
 *      WHENEVER THE PROVIDER SUPPLIES ONE. An account attributed to somebody
 *      else is always refused.
 *   4. `upsertConnected` refuses to move an account that already belongs to a
 *      different RClipper user, so a shared Page cannot be stolen.
 *
 * WHY DEFENCE 3 HAS A FALLBACK. On Quickstart the provider owns the OAuth flow
 * and does not reliably echo `external_id` back on every account payload. The
 * previous code treated a missing `external_id` exactly like a mismatched one
 * and silently dropped the account — which stranded every connection at
 * `pending` forever, with nothing in the logs to say why. When the provider
 * declines to attribute an account, we fall back to the two proofs we still
 * hold: a verified state token, or an OAuth attempt this user started for this
 * platform moments ago. Defence 4 still applies in both cases.
 */

import { createHash, randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { socialConnectionRepository } from "@/repositories";
import { socialPublishingProvider, POST_FOR_ME_PROVIDER_KEY } from "@/services/social-publishing";
import { SocialPublishingError } from "@/services/social-publishing/errors";
import type {
  ConnectedSocialAccount,
  SocialPlatform,
} from "@/services/social-publishing/types";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import type { SocialConnection } from "@/domain/models/SocialConnection";
import { isManagementEnabledFor, POST_FOR_ME_CONFIG } from "@/config/management";

/** How long a connection attempt stays valid. Long enough for a slow OAuth. */
const STATE_TTL_SECONDS = 15 * 60;

export class ManagementConnectionError extends Error {
  constructor(
    readonly code:
      | "feature_disabled"
      | "invalid_platform"
      | "invalid_state"
      | "state_expired"
      | "not_owner"
      | "account_claimed"
      | "provider_error",
    message: string
  ) {
    super(message);
    this.name = "ManagementConnectionError";
  }
}

/**
 * Secret for the state token.
 *
 * Reuses NEXTAUTH_SECRET, which is already required, already rotated with the
 * deployment, and already trusted for session signing — introducing a second
 * secret would add an operational failure mode without adding security.
 */
function stateSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to sign social connection state.");
  }
  return new TextEncoder().encode(secret);
}

/** Only the HASH of the token is stored, so a database leak is not replayable. */
function hashState(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Provider platform strings are compared case-insensitively and trimmed. */
function normalisePlatform(platform: string): string {
  return platform.trim().toLowerCase();
}

/**
 * Is this account usable for publishing?
 *
 * Only an EXPLICIT `disconnected` counts as evidence that it is not. A provider
 * payload that omits `status` means "the account exists and I have said nothing
 * against it" — reading that as "broken" is exactly what silently stranded
 * every connection at `pending`.
 */
function isLiveAccount(account: ConnectedSocialAccount): boolean {
  return account.status !== "disconnected";
}

type Ownership = "owned" | "unattributed" | "foreign";

/** What the PROVIDER says about who this account belongs to. */
function ownershipOf(account: ConnectedSocialAccount, userId: string): Ownership {
  const claimed = (account.externalId ?? "").trim();
  if (!claimed) return "unattributed";
  return claimed === userId ? "owned" : "foreign";
}

/** Outcome of inspecting a `state` parameter that arrived on the callback. */
type StateCheck =
  | { kind: "absent" }
  /** Verified as ours, single-use claim succeeded. */
  | { kind: "verified"; connection: SocialConnection }
  /** Not signed by us — the provider's own OAuth state. Ignored, not fatal. */
  | { kind: "not_ours" };

export interface StartConnectionResult {
  authorizationUrl: string;
  connectionId: string;
}

export class ManagementConnectionService {
  constructor(
    private connections = socialConnectionRepository,
    private provider = socialPublishingProvider,
    private audit = managementAuditService
  ) {}

  /**
   * Begin connecting one platform.
   *
   * A fresh authorization URL is generated per attempt — the provider documents
   * that these should not be cached or reused across sessions.
   *
   * THE STATE TOKEN IS NEVER STAPLED ONTO THE PROVIDER'S URL. It used to be,
   * via `authorizationUrl.searchParams.set("state", token)`, and that was
   * actively harmful: an OAuth authorization URL carries the provider's OWN
   * `state`, so `set()` overwrote it, and whatever `state` came back on the
   * redirect was then the provider's — which failed our JWT check and turned
   * every callback into a hard `invalid_state` error. Our token belongs on OUR
   * redirect URL, which the provider appends its parameters to. Quickstart
   * projects have no such URL, so they carry no state and lean on defences
   * 2, 3 and 4 instead.
   */
  async start(params: {
    user: { id: string; email?: string | null; role?: string | null };
    platform: SocialPlatform;
    redirectUrl?: string;
  }): Promise<StartConnectionResult> {
    if (!isManagementEnabledFor(params.user)) {
      throw new ManagementConnectionError("feature_disabled", "Not available.");
    }

    const nonce = randomUUID();
    const connectStateExpiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1000);

    // The pending row is created BEFORE the provider call so the state token can
    // reference a real id, and so an abandoned attempt is visible and sweepable.
    const pending = await this.connections.createPending({
      userId: params.user.id,
      provider: POST_FOR_ME_PROVIDER_KEY,
      platform: params.platform,
      connectStateHash: "pending",
      connectStateExpiresAt,
    });

    const token = await new SignJWT({
      uid: params.user.id,
      cid: pending.id,
      platform: params.platform,
      nonce,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${STATE_TTL_SECONDS}s`)
      .sign(stateSecret());

    // Store only the HASH of the issued token, so a database leak yields
    // nothing replayable.
    await this.connections.setStateHash(pending.id, hashState(token));

    // White Label only: the provider honours our redirect, so the state token
    // can ride on it and come back intact.
    const isWhiteLabel = POST_FOR_ME_CONFIG.projectType === "white_label";
    let redirectUrlOverride: string | undefined;
    if (isWhiteLabel && params.redirectUrl) {
      const redirect = new URL(params.redirectUrl);
      redirect.searchParams.set("state", token);
      redirectUrlOverride = redirect.toString();
    }

    try {
      const result = await this.provider.createAccountConnection({
        platform: params.platform,
        externalId: params.user.id,
        redirectUrlOverride,
      });

      return { authorizationUrl: result.authorizationUrl, connectionId: pending.id };
    } catch (err) {
      await this.connections
        .updateStatus(pending.id, SocialConnectionStatus.Removed)
        .catch(() => undefined);
      if (err instanceof SocialPublishingError) {
        throw new ManagementConnectionError(
          "provider_error",
          "Could not start the connection. Please try again."
        );
      }
      throw err;
    }
  }

  /**
   * Inspect the `state` parameter on a callback.
   *
   * A token that verifies against our secret is held to the full single-use
   * contract. A token that does NOT verify is the provider's own OAuth state
   * riding along on the redirect — it proves nothing, but it is not an attack
   * and must not abort the connection.
   */
  private async checkState(
    state: string | null | undefined,
    userId: string
  ): Promise<StateCheck> {
    if (!state) return { kind: "absent" };

    // Resolved BEFORE the try. A missing NEXTAUTH_SECRET is a deployment fault,
    // not an unrecognised token — swallowing it here would quietly demote every
    // one of our own state tokens to "not ours" and disable defence 1 across
    // the whole install, with nothing in the logs but a warning about the
    // provider's parameter.
    const secret = stateSecret();

    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(state, secret);
      claims = payload as Record<string, unknown>;
    } catch {
      console.warn("[management connection] callback state is not ours; ignoring", {
        userId,
      });
      return { kind: "not_ours" };
    }

    // Signed by us, but naming another user. That is the attack the token
    // exists to stop, so it is fatal rather than ignorable.
    if (claims.uid !== userId) {
      throw new ManagementConnectionError(
        "not_owner",
        "This connection belongs to another account."
      );
    }

    const pending = await this.connections.findByStateHash(hashState(state));
    if (!pending) {
      // Already claimed, or never issued — either way, refuse. This is what
      // makes the state single-use.
      throw new ManagementConnectionError("invalid_state", "Connection state already used.");
    }
    if (pending.userId !== userId) {
      throw new ManagementConnectionError("not_owner", "Access denied.");
    }
    if (
      pending.connectStateExpiresAt &&
      pending.connectStateExpiresAt.getTime() < Date.now()
    ) {
      throw new ManagementConnectionError("state_expired", "Connection attempt expired.");
    }

    await this.connections.clearState(pending.id);
    return { kind: "verified", connection: pending };
  }

  /** Platforms this user has a live OAuth attempt open for. */
  private async pendingPlatforms(userId: string): Promise<Set<string>> {
    const local = await this.connections.findByUserId(userId);
    return new Set<string>(
      local
        .filter((c) => c.connectionStatus === SocialConnectionStatus.Pending)
        .map((c) => normalisePlatform(c.platform))
    );
  }

  /**
   * Write one provider-confirmed account into our table and retire the OAuth
   * attempt it came from. Returns null when another RClipper user owns it.
   */
  private async claimAccount(
    userId: string,
    account: ConnectedSocialAccount
  ): Promise<SocialConnection | null> {
    const row = await this.connections.upsertConnected({
      userId,
      provider: this.provider.key,
      providerAccountId: account.externalAccountId,
      platform: account.platform,
      accountName: account.displayName,
      accountUsername: account.username,
      avatarUrl: account.avatarUrl,
      providerMetadata: account.metadata,
      providerProjectId: null,
    });
    if (!row) return null;

    // `upsertConnected` creates/updates the provider-backed row. The earlier
    // OAuth-attempt row has no provider_account_id and cannot conflict with
    // it, so retire those attempts explicitly or the settings page continues
    // to show a misleading pending duplicate after a successful callback.
    await this.connections.removePendingForUserPlatform(
      userId,
      this.provider.key,
      account.platform
    );

    return row;
  }

  /**
   * Handle the provider's redirect back to us.
   *
   * `accountIds` is a HINT. Every id is re-fetched from the provider and checked
   * against the session user before anything is written.
   */
  async completeCallback(params: {
    user: { id: string; email?: string | null; role?: string | null };
    state?: string | null;
    accountIds: string[];
  }): Promise<SocialConnection[]> {
    if (!isManagementEnabledFor(params.user)) {
      throw new ManagementConnectionError("feature_disabled", "Not available.");
    }

    const stateCheck = await this.checkState(params.state, params.user.id);
    const stateVerified = stateCheck.kind === "verified";
    const openAttempts = await this.pendingPlatforms(params.user.id);

    const connected: SocialConnection[] = [];
    // Every rejection is recorded with its reason. A callback that connects
    // nothing must never again be a silent shrug.
    const skipped: Array<{ accountId: string; reason: string }> = [];

    for (const accountId of params.accountIds) {
      // Server-to-server re-fetch. The redirect told us an id; the provider tells
      // us the truth.
      let account;
      try {
        account = await this.provider.getAccount(accountId);
      } catch (err) {
        console.error("[management connection] account re-fetch failed", {
          accountId,
          code: err instanceof SocialPublishingError ? err.code : "unknown",
        });
        skipped.push({ accountId, reason: "refetch_failed" });
        continue;
      }
      if (!account) {
        skipped.push({ accountId, reason: "not_found_at_provider" });
        continue;
      }

      const ownership = ownershipOf(account, params.user.id);
      if (ownership === "foreign") {
        // The decisive check: an account the provider attributes to somebody
        // else is never accepted, whatever the URL claimed.
        console.error("[management connection] rejected account with mismatched owner", {
          accountId,
        });
        skipped.push({ accountId, reason: "external_id_mismatch" });
        continue;
      }
      if (
        ownership === "unattributed" &&
        !stateVerified &&
        !openAttempts.has(normalisePlatform(account.platform))
      ) {
        // Provider gave us no attribution AND we hold no other proof. Refuse.
        console.error("[management connection] unattributed account with no open attempt", {
          accountId,
          platform: account.platform,
        });
        skipped.push({ accountId, reason: "unattributed_no_open_attempt" });
        continue;
      }
      if (!isLiveAccount(account)) {
        skipped.push({ accountId, reason: `provider_status_${account.status}` });
        continue;
      }

      const row = await this.claimAccount(params.user.id, account);
      if (!row) {
        // Already owned by a different RClipper user — refuse rather than move it.
        throw new ManagementConnectionError(
          "account_claimed",
          "That social account is already connected to another RClipper account."
        );
      }

      connected.push(row);

      await this.audit.record("management.social_account.connected", {
        userId: params.user.id,
        metadata: {
          platform: account.platform,
          username: account.username,
          providerAccountId: account.externalAccountId,
          attribution: ownership,
        },
      });
    }

    if (connected.length === 0 && skipped.length > 0) {
      console.error("[management connection] callback connected nothing", {
        userId: params.user.id,
        stateCheck: stateCheck.kind,
        skipped,
      });
    }

    return connected;
  }

  /**
   * Promote OAuth attempts the browser callback never completed.
   *
   * The provider documents GET /social-accounts?external_id=… as the way to
   * recover account IDs after OAuth, and it is filtered by our user id at the
   * provider — which is why an account it returns WITHOUT an `external_id` in
   * the payload may still be promoted, provided this user has an open attempt
   * for that platform. An account attributed to a different user is refused
   * outright, and `upsertConnected` still refuses to move an account another
   * RClipper user owns.
   *
   * Returns the rows it promoted.
   */
  private async reconcilePending(
    userId: string,
    openAttempts: Set<string>
  ): Promise<SocialConnection[]> {
    const promoted: SocialConnection[] = [];
    const skipped: Array<{ accountId: string; platform: string; reason: string }> = [];

    const providerAccounts = await this.provider.listAccounts(userId);

    for (const account of providerAccounts) {
      const platform = normalisePlatform(account.platform);
      const ownership = ownershipOf(account, userId);

      if (ownership === "foreign") {
        skipped.push({
          accountId: account.externalAccountId,
          platform,
          reason: "external_id_mismatch",
        });
        continue;
      }
      if (!isLiveAccount(account)) {
        skipped.push({
          accountId: account.externalAccountId,
          platform,
          reason: `provider_status_${account.status}`,
        });
        continue;
      }
      // An account the provider explicitly attributes to this user is ours to
      // record whether or not an attempt row survives — the sweep that deletes
      // stale `pending` rows would otherwise strand it permanently.
      if (ownership === "unattributed" && !openAttempts.has(platform)) {
        skipped.push({
          accountId: account.externalAccountId,
          platform,
          reason: "unattributed_no_open_attempt",
        });
        continue;
      }

      const row = await this.claimAccount(userId, account);
      if (!row) {
        skipped.push({
          accountId: account.externalAccountId,
          platform,
          reason: "owned_by_another_user",
        });
        continue;
      }
      promoted.push(row);
    }

    if (promoted.length === 0) {
      console.warn("[management connection] reconciliation promoted nothing", {
        userId,
        openAttempts: [...openAttempts],
        providerAccounts: providerAccounts.length,
        skipped,
      });
    }

    return promoted;
  }

  /** The user's connections, for the connections page. */
  async list(userId: string): Promise<SocialConnection[]> {
    const local = await this.connections.findByUserId(userId);
    const openAttempts = new Set<string>(
      local
        .filter((connection) => connection.connectionStatus === SocialConnectionStatus.Pending)
        .map((connection) => normalisePlatform(connection.platform))
    );
    if (openAttempts.size === 0) return local;

    try {
      await this.reconcilePending(userId, openAttempts);
      return this.connections.findByUserId(userId);
    } catch (err) {
      // Channel Management remains usable when the provider is temporarily
      // unavailable. Pending attempts stay visibly incomplete and can be
      // retried; they are never promoted without provider confirmation.
      console.error("[management connection] pending reconciliation failed", {
        userId,
        code: err instanceof SocialPublishingError ? err.code : "unknown",
      });
      return local;
    }
  }

  /**
   * Re-read display metadata and status from the provider.
   *
   * On a PENDING row there is no provider account to re-read, so "Refresh"
   * used to be a no-op — leaving a stranded attempt with no way out except
   * starting another one, which just added a second stranded row. It now runs
   * the same reconciliation `list()` does, scoped to that row's platform, so
   * the button can actually rescue a connection whose callback never arrived.
   */
  async refresh(userId: string, connectionId: string): Promise<SocialConnection> {
    const row = await this.connections.findById(connectionId);
    if (!row || row.userId !== userId) {
      throw new ManagementConnectionError("not_owner", "Connection not found.");
    }

    if (!row.providerAccountId) {
      const platform = normalisePlatform(row.platform);
      let promoted: SocialConnection[];
      try {
        promoted = await this.reconcilePending(userId, new Set<string>([platform]));
      } catch (err) {
        throw new ManagementConnectionError(
          "provider_error",
          err instanceof SocialPublishingError
            ? "The provider could not be reached. Please try again."
            : "Could not refresh this connection."
        );
      }
      return (
        promoted.find((item) => normalisePlatform(item.platform) === platform) ??
        promoted[0] ??
        row
      );
    }

    const account = await this.provider.getAccount(row.providerAccountId);
    if (!account) {
      // The provider has forgotten it — reflect that rather than showing a
      // connection the user cannot actually publish through.
      return this.connections.updateStatus(row.id, SocialConnectionStatus.Disconnected);
    }

    const updated = await this.connections.upsertConnected({
      userId,
      provider: row.provider,
      providerAccountId: account.externalAccountId,
      platform: account.platform,
      accountName: account.displayName,
      accountUsername: account.username,
      avatarUrl: account.avatarUrl,
      providerMetadata: account.metadata,
      providerProjectId: row.providerProjectId,
    });
    if (!updated) throw new ManagementConnectionError("not_owner", "Access denied.");

    return isLiveAccount(account)
      ? updated
      : this.connections.updateStatus(updated.id, SocialConnectionStatus.Disconnected);
  }

  /**
   * Disconnect an account.
   *
   * Removed locally even if the provider call fails: the user asked for it gone
   * from their dashboard, and leaving it visible because a third party was
   * unreachable would be the wrong answer. The provider-side call is retried by
   * the caller if it matters.
   */
  async disconnect(userId: string, connectionId: string): Promise<void> {
    const row = await this.connections.findById(connectionId);
    if (!row || row.userId !== userId) {
      throw new ManagementConnectionError("not_owner", "Connection not found.");
    }

    if (row.providerAccountId) {
      try {
        await this.provider.disconnectAccount(row.providerAccountId);
      } catch (err) {
        console.error("[management connection] provider disconnect failed", {
          connectionId,
          code: err instanceof SocialPublishingError ? err.code : "unknown",
        });
      }
    }

    await this.connections.updateStatus(row.id, SocialConnectionStatus.Removed);
    await this.audit.record("management.social_account.disconnected", {
      userId,
      metadata: { platform: row.platform, providerAccountId: row.providerAccountId },
    });
  }

}

export const managementConnectionService = new ManagementConnectionService();
