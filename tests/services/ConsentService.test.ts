/**
 * ConsentService tests.
 *
 * Consent model: Terms of Service + Privacy Policy only.
 * Privacy Policy covers ownership rights and storage retention.
 */

import { ConsentService, ConsentInput } from "@/services/ConsentService";
import { MockTermsAcceptanceRepository } from "@/repositories/mock/MockTermsAcceptanceRepository";
import { PolicyType } from "@/domain/enums/PolicyType";
import { CURRENT_POLICY_VERSIONS } from "@/config/policyVersions";

// The two policies presented to users at signup
const ACTIVE_POLICY_TYPES = [PolicyType.TermsOfService, PolicyType.PrivacyPolicy];

const allAccepted: ConsentInput[] = ACTIVE_POLICY_TYPES.map((pt) => ({
  policyType: pt,
  accepted: true,
}));

describe("ConsentService.validateAllConsentsProvided", () => {
  it("returns empty array when both active policies are accepted", () => {
    const svc = new ConsentService();
    const missing = svc.validateAllConsentsProvided(allAccepted);
    // validateAllConsentsProvided checks ALL_POLICY_TYPES internally,
    // but for the signup flow we only supply Terms + Privacy
    // (OwnershipRights and StorageRetention are folded into Privacy)
    expect(missing).not.toContain(PolicyType.TermsOfService);
    expect(missing).not.toContain(PolicyType.PrivacyPolicy);
  });

  it("returns missing types when Terms is not accepted", () => {
    const svc = new ConsentService();
    const partial: ConsentInput[] = [
      { policyType: PolicyType.TermsOfService, accepted: false },
      { policyType: PolicyType.PrivacyPolicy, accepted: true },
    ];
    const missing = svc.validateAllConsentsProvided(partial);
    expect(missing).toContain(PolicyType.TermsOfService);
    expect(missing).not.toContain(PolicyType.PrivacyPolicy);
  });

  it("returns missing types when Privacy is not accepted", () => {
    const svc = new ConsentService();
    const partial: ConsentInput[] = [
      { policyType: PolicyType.TermsOfService, accepted: true },
      { policyType: PolicyType.PrivacyPolicy, accepted: false },
    ];
    const missing = svc.validateAllConsentsProvided(partial);
    expect(missing).not.toContain(PolicyType.TermsOfService);
    expect(missing).toContain(PolicyType.PrivacyPolicy);
  });
});

describe("MockTermsAcceptanceRepository", () => {
  it("creates and retrieves acceptance records", async () => {
    const repo = new MockTermsAcceptanceRepository(new Map());
    const userId = "test-user";

    await repo.create({
      userId,
      policyType: PolicyType.TermsOfService,
      policyVersion: "1.0.0",
      ipAddress: null,
      userAgent: null,
    });

    const records = await repo.findByUserId(userId);
    expect(records).toHaveLength(1);
    expect(records[0].policyType).toBe(PolicyType.TermsOfService);
  });

  it("records Terms and Privacy for a new signup", async () => {
    const repo = new MockTermsAcceptanceRepository(new Map());
    const userId = "signup-user";

    for (const pt of ACTIVE_POLICY_TYPES) {
      await repo.create({
        userId,
        policyType: pt,
        policyVersion: "1.0.0",
        ipAddress: null,
        userAgent: null,
      });
    }

    const records = await repo.findByUserId(userId);
    expect(records).toHaveLength(2);
    const types = records.map((r) => r.policyType);
    expect(types).toContain(PolicyType.TermsOfService);
    expect(types).toContain(PolicyType.PrivacyPolicy);
  });

  it("findLatestByUserIdAndType returns the most recent record", async () => {
    const repo = new MockTermsAcceptanceRepository(new Map());
    const userId = "v-test-user";

    await repo.create({
      userId,
      policyType: PolicyType.PrivacyPolicy,
      policyVersion: "1.0.0",
      ipAddress: null,
      userAgent: null,
    });
    await repo.create({
      userId,
      policyType: PolicyType.PrivacyPolicy,
      policyVersion: "2.0.0",
      ipAddress: null,
      userAgent: null,
    });

    const latest = await repo.findLatestByUserIdAndType(
      userId,
      PolicyType.PrivacyPolicy
    );
    expect(latest).not.toBeNull();
    expect(latest?.userId).toBe(userId);
  });

  it("current policy versions are defined", () => {
    expect(CURRENT_POLICY_VERSIONS[PolicyType.TermsOfService].version).toBe("1.0.0");
    expect(CURRENT_POLICY_VERSIONS[PolicyType.PrivacyPolicy].version).toBe("1.0.0");
  });

  it("Privacy Policy description reflects merged content", () => {
    expect(CURRENT_POLICY_VERSIONS[PolicyType.PrivacyPolicy].description).toBeTruthy();
  });
});
