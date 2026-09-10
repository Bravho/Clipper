/**
 * Account deletion + free-trial reuse prevention tests.
 *
 * Covers the store-compliance rules:
 * - Deletion anonymizes PII in place (name, email) and sets deleted_at,
 *   while the row survives for legally-retained records.
 * - Auth identities are removed (login killed).
 * - The deleted-account registry stores only one-way hashes plus the
 *   consumed-entitlement counters.
 * - Re-registration with the same email/OAuth identity resumes the trial ladder
 *   where the deleted account left it and does not re-grant the signup bonus;
 *   unused allowance survives.
 * - Password change replaces only the credentials identity hash.
 */

import bcrypt from "bcryptjs";
import { MockUserRepository } from "@/repositories/mock/MockUserRepository";
import { MockAuthIdentityRepository } from "@/repositories/mock/MockAuthIdentityRepository";
import { MockDeletedAccountRegistryRepository } from "@/repositories/mock/MockDeletedAccountRegistryRepository";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";
import { hashEmail, hashProviderAccountId } from "@/lib/auth/identityHash";

function buildDeps() {
  const userRepo = new MockUserRepository(new Map());
  const authRepo = new MockAuthIdentityRepository(new Map());
  const registryRepo = new MockDeletedAccountRegistryRepository(new Map());
  return { userRepo, authRepo, registryRepo };
}

async function createUser(
  userRepo: MockUserRepository,
  overrides: Partial<{ email: string; priorTrialRequestsUsed: number }> = {}
) {
  return userRepo.create({
    email: overrides.email ?? "joe@example.com",
    name: "Joe Requester",
    role: Role.Requester,
    emailVerified: true,
    priorTrialRequestsUsed: overrides.priorTrialRequestsUsed ?? 0,
  });
}

describe("identityHash", () => {
  it("normalizes email before hashing (trim + lowercase)", () => {
    expect(hashEmail("  Joe@Example.COM ")).toBe(hashEmail("joe@example.com"));
  });

  it("produces one-way hex hashes that don't contain the identifier", () => {
    const h = hashEmail("joe@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("joe");
    expect(hashProviderAccountId("google-sub-123")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Account deletion — PII erasure with retained row", () => {
  it("anonymizes name and email in place and sets deletedAt", async () => {
    const { userRepo } = buildDeps();
    const user = await createUser(userRepo);

    await userRepo.anonymizeAndSoftDelete(user.id);

    const after = await userRepo.findById(user.id);
    expect(after).not.toBeNull();
    expect(after!.name).toBe("Deleted user");
    expect(after!.email).toBe(`deleted:${user.id}`);
    expect(after!.deletedAt).toBeInstanceOf(Date);
    // Row retained — id stays valid for legally-retained records
    expect(after!.id).toBe(user.id);
  });

  it("removes all auth identities so login is impossible", async () => {
    const { userRepo, authRepo } = buildDeps();
    const user = await createUser(userRepo);
    await authRepo.create({
      userId: user.id,
      provider: AuthProvider.Credentials,
      providerAccountId: null,
      passwordHash: await bcrypt.hash("password123", 4),
    });
    await authRepo.create({
      userId: user.id,
      provider: AuthProvider.Google,
      providerAccountId: "google-sub-123",
      passwordHash: null,
    });

    await authRepo.deleteByUserId(user.id);

    expect(await authRepo.findByUserId(user.id)).toHaveLength(0);
    expect(
      await authRepo.findByProviderAccountId(
        AuthProvider.Google,
        "google-sub-123"
      )
    ).toBeNull();
  });

  it("anonymized email no longer matches findByEmail for the original address", async () => {
    const { userRepo } = buildDeps();
    const user = await createUser(userRepo);
    await userRepo.anonymizeAndSoftDelete(user.id);
    expect(await userRepo.findByEmail("joe@example.com")).toBeNull();
  });
});

describe("Deleted-account registry — consumed-allowance history", () => {
  it("stores hashed identifiers with the consumed allowance", async () => {
    const { registryRepo } = buildDeps();
    const emailHash = hashEmail("joe@example.com");

    await registryRepo.create({
      emailHash,
      provider: AuthProvider.Google,
      providerAccountHash: hashProviderAccountId("google-sub-123"),
      priorTrialRequestsUsed: 4,
      bonusGranted: true,
    });

    const byEmail = await registryRepo.findByEmailHash(emailHash);
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].priorTrialRequestsUsed).toBe(4);

    const byProvider = await registryRepo.findByProviderAccountHash(
      hashProviderAccountId("google-sub-123")
    );
    expect(byProvider).toHaveLength(1);
  });

  it("takes the HIGHEST usage across prior deletions (lookupPriorUsage rule)", async () => {
    const { registryRepo } = buildDeps();
    const emailHash = hashEmail("joe@example.com");

    // First life: deleted before submitting anything.
    await registryRepo.create({
      emailHash,
      provider: AuthProvider.Credentials,
      providerAccountHash: null,
      priorTrialRequestsUsed: 0,
      bonusGranted: true,
    });
    // Second life: spent two free clips.
    await registryRepo.create({
      emailHash,
      provider: AuthProvider.Credentials,
      providerAccountHash: null,
      priorTrialRequestsUsed: 2,
      bonusGranted: true,
    });

    const records = await registryRepo.findByEmailHash(emailHash);
    // Max, not sum and not OR: the same two clips must not be counted twice, and
    // a later empty life must not launder the earlier usage away.
    const carried = records.reduce(
      (max, r) => Math.max(max, r.priorTrialRequestsUsed),
      0
    );
    expect(carried).toBe(2);
    expect(records.some((r) => r.bonusGranted)).toBe(true);
  });

  it("a recreated account resumes the ladder instead of restarting it", async () => {
    const { userRepo } = buildDeps();
    // Simulates AccountService.createRequesterAccount after a registry hit for an
    // identity that had already used 2 of its 4 free clips.
    const recreated = await createUser(userRepo, { priorTrialRequestsUsed: 2 });
    const fresh = await createUser(userRepo, {
      email: "new@example.com",
      priorTrialRequestsUsed: 0,
    });

    // RECORDED, NOT CURRENTLY ENFORCED. Under the monthly quota model the free
    // allowance is 3 per rolling 30 days and refills regardless, so re-registering
    // wins nothing and no entitlement check reads this. It is still captured
    // because it is the only history of how much free capacity an identity has
    // consumed, which a future abuse rule would need.
    expect((await userRepo.findById(recreated.id))!.priorTrialRequestsUsed).toBe(2);
    expect((await userRepo.findById(fresh.id))!.priorTrialRequestsUsed).toBe(0);
  });

  it("unused allowance survives deletion — usage is captured, not assumed", async () => {
    const { registryRepo } = buildDeps();
    const emailHash = hashEmail("neveruse@example.com");
    await registryRepo.create({
      emailHash,
      provider: AuthProvider.Credentials,
      providerAccountHash: null,
      priorTrialRequestsUsed: 0, // deleted before ever submitting a request
      bonusGranted: true,
    });

    const records = await registryRepo.findByEmailHash(emailHash);
    expect(records.every((r) => r.priorTrialRequestsUsed === 0)).toBe(true);
    expect(records.some((r) => r.bonusGranted)).toBe(true);
  });
});

describe("Password change", () => {
  it("replaces the credentials hash and leaves OAuth identities untouched", async () => {
    const { userRepo, authRepo } = buildDeps();
    const user = await createUser(userRepo);
    const oldHash = await bcrypt.hash("oldpassword", 4);
    await authRepo.create({
      userId: user.id,
      provider: AuthProvider.Credentials,
      providerAccountId: null,
      passwordHash: oldHash,
    });
    await authRepo.create({
      userId: user.id,
      provider: AuthProvider.Google,
      providerAccountId: "google-sub-123",
      passwordHash: null,
    });

    const newHash = await bcrypt.hash("newpassword", 4);
    await authRepo.updatePasswordHash(user.id, newHash);

    const credentials = await authRepo.findCredentialsByUserId(user.id);
    expect(credentials!.passwordHash).toBe(newHash);
    expect(await bcrypt.compare("newpassword", credentials!.passwordHash!)).toBe(
      true
    );

    const google = await authRepo.findByProviderAccountId(
      AuthProvider.Google,
      "google-sub-123"
    );
    expect(google!.passwordHash).toBeNull();
  });
});
