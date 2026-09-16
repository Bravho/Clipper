import { timingSafeEqual } from "node:crypto";
import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import type { User } from "@/domain/models/User";

const LOCAL_USER_ID = "studio-local-owner";

export function isStudioLocalUserId(userId: string): boolean {
  return userId === LOCAL_USER_ID;
}

/** Isolated owner login for this worktree. It cannot run in production. */
export function isStudioLocalAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RCLIPPER_STUDIO_ENABLED === "true" &&
    process.env.RCLIPPER_STUDIO_LOCAL_AUTH_ENABLED === "true" &&
    Boolean(process.env.RCLIPPER_STUDIO_LOCAL_EMAIL?.trim()) &&
    Boolean(process.env.RCLIPPER_STUDIO_LOCAL_PASSWORD)
  );
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function verifyStudioLocalCredentials(
  email: string,
  password: string
): User | null {
  if (!isStudioLocalAuthEnabled()) return null;

  const configuredEmail = process.env.RCLIPPER_STUDIO_LOCAL_EMAIL!.trim().toLowerCase();
  const configuredPassword = process.env.RCLIPPER_STUDIO_LOCAL_PASSWORD!;
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
    name: "Studio Owner",
    role: Role.Requester,
    emailVerified: true,
    priorTrialRequestsUsed: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const STUDIO_LOCAL_AUTH_PROVIDER = AuthProvider.Credentials;
