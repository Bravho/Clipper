import { ManagementConnectionService } from "@/services/management/ManagementConnectionService";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import type { SocialConnection } from "@/domain/models/SocialConnection";
import type { ConnectedSocialAccount } from "@/services/social-publishing/types";

jest.mock("jose", () => ({
  SignJWT: jest.fn(),
  jwtVerify: jest.fn(),
}));

process.env.RCLIPPER_MANAGEMENT_ENABLED = "true";
// Required to sign and verify the connection state token. Without it
// `stateSecret()` throws, which is the correct production behaviour — see
// `checkState`, which deliberately does not catch it.
process.env.NEXTAUTH_SECRET = "test-state-secret";

const USER = { id: "user-1", email: "owner@example.com", role: "requester" };

function connection(
  overrides: Partial<SocialConnection> = {}
): SocialConnection {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: "connection-pending",
    userId: USER.id,
    provider: "post_for_me",
    providerAccountId: null,
    providerProjectId: null,
    platform: "youtube",
    accountName: null,
    accountUsername: null,
    avatarUrl: null,
    connectionStatus: SocialConnectionStatus.Pending,
    providerMetadata: null,
    connectStateHash: "hash",
    connectStateExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
    connectedAt: null,
    lastSyncedAt: null,
    disconnectedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function providerAccount(
  overrides: Partial<ConnectedSocialAccount> = {}
): ConnectedSocialAccount {
  return {
    externalAccountId: "social-account-1",
    platform: "youtube",
    externalId: USER.id,
    platformUserId: "youtube-user-1",
    username: "@rclipper",
    displayName: "RClipper",
    avatarUrl: null,
    status: "connected",
    metadata: { capability: "video" },
    ...overrides,
  };
}

function setup() {
  const pending = connection();
  const connected = connection({
    id: "connection-live",
    providerAccountId: "social-account-1",
    accountName: "RClipper",
    accountUsername: "@rclipper",
    connectionStatus: SocialConnectionStatus.Connected,
    connectStateHash: null,
    connectStateExpiresAt: null,
    connectedAt: new Date("2026-07-31T01:00:00.000Z"),
  });
  const connections = {
    findByUserId: jest.fn().mockResolvedValue([pending]),
    findById: jest.fn().mockResolvedValue(pending),
    upsertConnected: jest.fn().mockResolvedValue(connected),
    removePendingForUserPlatform: jest.fn().mockResolvedValue(1),
    updateStatus: jest.fn().mockResolvedValue(connected),
  };
  const provider = {
    key: "post_for_me",
    listAccounts: jest.fn(),
    getAccount: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ManagementConnectionService(
    connections as never,
    provider as never,
    audit as never
  );
  return { service, connections, provider, audit, pending, connected };
}

describe("ManagementConnectionService", () => {
  beforeEach(() => {
    const { jwtVerify } = jest.requireMock("jose");
    (jwtVerify as jest.Mock).mockReset();
  });

  it("reconciles a provider-confirmed account after a missed browser callback", async () => {
    const { service, connections, provider, pending, connected } = setup();
    connections.findByUserId
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([connected]);
    provider.listAccounts.mockResolvedValue([providerAccount()]);

    await expect(service.list(USER.id)).resolves.toEqual([connected]);
    expect(provider.listAccounts).toHaveBeenCalledWith(USER.id);
    expect(connections.upsertConnected).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        providerAccountId: "social-account-1",
        platform: "youtube",
      })
    );
    expect(connections.removePendingForUserPlatform).toHaveBeenCalledWith(
      USER.id,
      "post_for_me",
      "youtube"
    );
  });

  it("never promotes an account whose provider external id belongs to another user", async () => {
    const { service, connections, provider, pending } = setup();
    connections.findByUserId.mockResolvedValue([pending]);
    provider.listAccounts.mockResolvedValue([
      providerAccount({ externalId: "another-user" }),
    ]);

    await expect(service.list(USER.id)).resolves.toEqual([pending]);
    expect(connections.upsertConnected).not.toHaveBeenCalled();
    expect(connections.removePendingForUserPlatform).not.toHaveBeenCalled();
  });

  it("keeps local pending attempts visible when the provider is unavailable", async () => {
    const { service, connections, provider, pending } = setup();
    connections.findByUserId.mockResolvedValue([pending]);
    provider.listAccounts.mockRejectedValue(new Error("provider unavailable"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(service.list(USER.id)).resolves.toEqual([pending]);
    expect(connections.upsertConnected).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("retires the pending attempt after a successful callback claim", async () => {
    const { service, connections, provider, audit, connected } = setup();
    provider.getAccount.mockResolvedValue(providerAccount());

    await expect(
      service.completeCallback({
        user: USER,
        accountIds: ["social-account-1"],
      })
    ).resolves.toEqual([connected]);

    expect(connections.removePendingForUserPlatform).toHaveBeenCalledWith(
      USER.id,
      "post_for_me",
      "youtube"
    );
    expect(audit.record).toHaveBeenCalledWith(
      "management.social_account.connected",
      expect.objectContaining({ userId: USER.id })
    );
  });

  // ── The three gates that used to strand every connection at `pending` ──────

  it("promotes an account the provider returns without a status field", async () => {
    // Post for Me does not always echo `status`. Reading "unknown" as
    // "disconnected" silently dropped every account and left the publish modal
    // claiming the user had no channels.
    const { service, connections, provider, pending, connected } = setup();
    connections.findByUserId
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([connected]);
    provider.listAccounts.mockResolvedValue([
      providerAccount({ status: undefined as never }),
    ]);

    await expect(service.list(USER.id)).resolves.toEqual([connected]);
    expect(connections.upsertConnected).toHaveBeenCalled();
  });

  it("promotes an unattributed account when this user has an open attempt", async () => {
    const { service, connections, provider, pending, connected } = setup();
    connections.findByUserId
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([connected]);
    provider.listAccounts.mockResolvedValue([providerAccount({ externalId: null })]);

    await expect(service.list(USER.id)).resolves.toEqual([connected]);
    expect(connections.upsertConnected).toHaveBeenCalled();
  });

  it("refuses an unattributed account on a platform with no open attempt", async () => {
    const { service, connections, provider, pending } = setup();
    connections.findByUserId.mockResolvedValue([pending]); // youtube only
    provider.listAccounts.mockResolvedValue([
      providerAccount({ externalId: null, platform: "tiktok" }),
    ]);
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(service.list(USER.id)).resolves.toEqual([pending]);
    expect(connections.upsertConnected).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("skips an explicitly disconnected provider account", async () => {
    const { service, connections, provider, pending } = setup();
    connections.findByUserId.mockResolvedValue([pending]);
    provider.listAccounts.mockResolvedValue([
      providerAccount({ status: "disconnected" }),
    ]);
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(service.list(USER.id)).resolves.toEqual([pending]);
    expect(connections.upsertConnected).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("ignores a callback state parameter that is not one of our tokens", async () => {
    // On Quickstart the `state` on the redirect belongs to the provider's own
    // OAuth handshake. Treating it as a forged token turned every callback into
    // a hard failure.
    const { service, provider, connected } = setup();
    const { jwtVerify } = jest.requireMock("jose");
    (jwtVerify as jest.Mock).mockRejectedValue(new Error("signature verification failed"));
    provider.getAccount.mockResolvedValue(providerAccount());
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      service.completeCallback({
        user: USER,
        state: "provider-oauth-state",
        accountIds: ["social-account-1"],
      })
    ).resolves.toEqual([connected]);
    consoleSpy.mockRestore();
  });

  it("still refuses a state token we signed for a different user", async () => {
    const { service } = setup();
    const { jwtVerify } = jest.requireMock("jose");
    (jwtVerify as jest.Mock).mockResolvedValue({ payload: { uid: "another-user" } });

    await expect(
      service.completeCallback({
        user: USER,
        state: "our-token-for-someone-else",
        accountIds: ["social-account-1"],
      })
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  it("rescues a pending row through refresh instead of doing nothing", async () => {
    const { service, connections, provider, pending, connected } = setup();
    connections.findById.mockResolvedValue(pending);
    connections.findByUserId.mockResolvedValue([pending]);
    provider.listAccounts.mockResolvedValue([providerAccount()]);

    await expect(service.refresh(USER.id, pending.id)).resolves.toEqual(connected);
    expect(provider.listAccounts).toHaveBeenCalledWith(USER.id);
    expect(connections.upsertConnected).toHaveBeenCalled();
  });
});
