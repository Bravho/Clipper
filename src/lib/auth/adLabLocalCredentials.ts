import { timingSafeEqual } from "node:crypto";
import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import type { User } from "@/domain/models/User";
import { AD_LAB_CONFIG } from "@/config/adLab";

// Kept as "studio-local-owner" so workspaces saved before the rename still load.
const LOCAL_USER_ID = "studio-local-owner";

export function isAdLabLocalUserId(userId: string): boolean {
  return userId === LOCAL_USER_ID;
}

/** Isolated owner login for this worktree. It cannot run in production. */
export function isAdLabLocalAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    AD_LAB_CONFIG.enabled &&
    AD_LAB_CONFIG.localAuthEnabled &&
    Boolean(AD_LAB_CONFIG.localEmail) &&
    Boolean(AD_LAB_CONFIG.localPassword)
  );
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function verifyAdLabLocalCredentials(
  email: string,
  password: string
): User | null {
  if (!isAdLabLocalAuthEnabled()) return null;

  const configuredEmail = AD_LAB_CONFIG.localEmail.toLowerCase();
  const configuredPassword = AD_LAB_CONFIG.localPassword;
  if (
    email.trim().toLowerCase() !== configuredEmail ||
    !equalSecret(password, configuredPassword)
  ) {
    return null;
  }

  const now = new Date();
  return {
    id: LOCAL_USER_ID,
    email: configuredEmail,
    name: "Ad Lab Owner",
    role: Role.Requester,
    emailVerified: true,
    priorTrialRequestsUsed: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const AD_LAB_LOCAL_AUTH_PROVIDER = AuthProvider.Credentials;
