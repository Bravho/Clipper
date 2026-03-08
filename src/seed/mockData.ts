import bcrypt from "bcryptjs";
import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { TransactionType } from "@/domain/enums/TransactionType";
import { PolicyType } from "@/domain/enums/PolicyType";
import { CREDITS_CONFIG } from "@/config/credits";
import { CURRENT_POLICY_VERSIONS } from "@/config/policyVersions";
import type { User } from "@/domain/models/User";
import type { AuthIdentity } from "@/domain/models/AuthIdentity";
import type { CreditWallet } from "@/domain/models/CreditWallet";
import type { CreditTransaction } from "@/domain/models/CreditTransaction";
import type { TermsAcceptance } from "@/domain/models/TermsAcceptance";
import {
  SEED_REQUEST_TRANSACTIONS,
  SEED_REQUESTER_WALLET_OVERRIDE,
} from "@/seed/requestSeedData";

// ---------------------------------------------------------------------------
// Seed account credentials (for development / testing)
// ---------------------------------------------------------------------------
// Requester:  user@example.com        / password123
// Staff:      staff@clipper.internal  / staffpass123
// Admin:      admin@clipper.internal  / adminpass123
// ---------------------------------------------------------------------------

// Hash passwords synchronously at module initialisation.
// This is intentionally slow — acceptable for mock seed data only.
const REQUESTER_HASH = bcrypt.hashSync("password123", 10);
const STAFF_HASH = bcrypt.hashSync("staffpass123", 10);
const ADMIN_HASH = bcrypt.hashSync("adminpass123", 10);

const now = new Date("2024-01-01T00:00:00Z");

// ---- Users ----------------------------------------------------------------

export const SEED_USERS: User[] = [
  {
    id: "user-requester-001",
    email: "user@example.com",
    name: "Alex Requester",
    role: Role.Requester,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "user-staff-001",
    email: "staff@clipper.internal",
    name: "Sam Staff",
    role: Role.Staff,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "user-admin-001",
    email: "admin@clipper.internal",
    name: "Admin User",
    role: Role.Admin,
    createdAt: now,
    updatedAt: now,
  },
];

// ---- Auth identities ------------------------------------------------------

export const SEED_AUTH_IDENTITIES: AuthIdentity[] = [
  {
    id: "auth-requester-001",
    userId: "user-requester-001",
    provider: AuthProvider.Credentials,
    providerAccountId: null,
    passwordHash: REQUESTER_HASH,
    createdAt: now,
  },
  {
    id: "auth-staff-001",
    userId: "user-staff-001",
    provider: AuthProvider.Credentials,
    providerAccountId: null,
    passwordHash: STAFF_HASH,
    createdAt: now,
  },
  {
    id: "auth-admin-001",
    userId: "user-admin-001",
    provider: AuthProvider.Credentials,
    providerAccountId: null,
    passwordHash: ADMIN_HASH,
    createdAt: now,
  },
];

// ---- Credit wallets -------------------------------------------------------

export const SEED_WALLETS: CreditWallet[] = [
  {
    id: "wallet-requester-001",
    userId: "user-requester-001",
    // Phase 2B: balance reflects signup bonus + admin grant - request charges.
    // See SEED_REQUESTER_WALLET_OVERRIDE in requestSeedData.ts for the override.
    balance: SEED_REQUESTER_WALLET_OVERRIDE.balance ?? CREDITS_CONFIG.SIGNUP_BONUS_CREDITS,
    initialCreditsGranted: true,
    createdAt: now,
    updatedAt: SEED_REQUESTER_WALLET_OVERRIDE.updatedAt ?? now,
  },
  // Staff and admin do not have credit wallets
];

// ---- Credit transactions --------------------------------------------------

export const SEED_TRANSACTIONS: CreditTransaction[] = [
  {
    id: "txn-requester-bonus-001",
    userId: "user-requester-001",
    amount: CREDITS_CONFIG.SIGNUP_BONUS_CREDITS,
    type: TransactionType.SignupBonus,
    description: "Welcome! 30 free credits on account creation.",
    referenceId: null,
    createdAt: now,
  },
  // Phase 2B: request charge transactions appended
  ...SEED_REQUEST_TRANSACTIONS,
];

// ---- Terms acceptances ----------------------------------------------------

// Only Terms and Privacy are recorded — Privacy covers ownership + storage.
const makeAcceptances = (userId: string): TermsAcceptance[] =>
  [PolicyType.TermsOfService, PolicyType.PrivacyPolicy].map((policyType, i) => ({
    id: `acceptance-${userId}-${i}`,
    userId,
    policyType,
    policyVersion: CURRENT_POLICY_VERSIONS[policyType].version,
    acceptedAt: now,
    ipAddress: null,
    userAgent: null,
  }));

export const SEED_ACCEPTANCES: TermsAcceptance[] = [
  ...makeAcceptances("user-requester-001"),
];
