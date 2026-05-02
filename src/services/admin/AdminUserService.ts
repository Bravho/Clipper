import bcrypt from "bcryptjs";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";
import { User } from "@/domain/models/User";
import { userRepository, authIdentityRepository, creditWalletRepository } from "@/repositories";

/**
 * AdminUserService — admin-side user visibility and management.
 *
 * Provides read-heavy user management operations for the admin portal.
 * Account editing and staff provisioning are deferred to later phases.
 *
 * TODO: Add staff provisioning (create staff/admin accounts) in a later phase.
 * TODO: Add account suspension / role change support.
 * TODO: PostgreSQL — userRepository is already Postgres-backed (Phase 2A).
 *   Credit wallet is also Postgres-backed.
 */
export class AdminUserService {
  /** List all users across all roles. */
  async listAllUsers(): Promise<User[]> {
    return userRepository.listAll();
  }

  /** List users filtered by role. */
  async listUsersByRole(role: Role): Promise<User[]> {
    const all = await userRepository.listAll();
    return all.filter((u) => u.role === role);
  }

  /** Get a single user by ID. */
  async getUserById(id: string): Promise<User | null> {
    return userRepository.findById(id);
  }

  /**
   * Get user summary with credit balance (for requesters only).
   * TODO: Extend with last active timestamp, request count, etc.
   */
  async getUserWithCredits(userId: string): Promise<{
    user: User;
    creditBalance: number | null;
  }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error(`User not found: ${userId}`);

    let creditBalance: number | null = null;
    if (user.role === Role.Requester) {
      const wallet = await creditWalletRepository.findByUserId(userId);
      creditBalance = wallet?.balance ?? null;
    }

    return { user, creditBalance };
  }

  /**
   * Provision a new editor account.
   * Editors are internal team members — no credit wallet or consent records.
   *
   * Only callable by admins (enforced at the API route level).
   */
  async createEditorAccount(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<User> {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new Error("An account with this email address already exists.");
    }

    const user = await userRepository.create({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      role: Role.Editor,
    });

    const passwordHash = await bcrypt.hash(input.password, 12);
    await authIdentityRepository.create({
      userId: user.id,
      provider: AuthProvider.Credentials,
      providerAccountId: null,
      passwordHash,
    });

    return user;
  }

  /**
   * List all requesters with their credit balances.
   * Used by the admin credits page.
   */
  async listRequestersWithCredits(): Promise<
    Array<{ user: User; creditBalance: number | null }>
  > {
    const requesters = await this.listUsersByRole(Role.Requester);
    const results = await Promise.all(
      requesters.map(async (user) => {
        const wallet = await creditWalletRepository.findByUserId(user.id);
        return { user, creditBalance: wallet?.balance ?? null };
      })
    );
    return results;
  }
}

export const adminUserService = new AdminUserService();
