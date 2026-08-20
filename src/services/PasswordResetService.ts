import crypto from "crypto";
import bcrypt from "bcryptjs";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { IUserRepository } from "@/repositories/interfaces/IUserRepository";
import { IAuthIdentityRepository } from "@/repositories/interfaces/IAuthIdentityRepository";
import { IPasswordResetTokenRepository } from "@/repositories/interfaces/IPasswordResetTokenRepository";
import {
  ResetRequestOutcome,
  ResetTokenState,
} from "@/domain/enums/PasswordReset";
import { sendEmail } from "@/lib/email";

// Re-exported so server-side callers can keep a single import. Client
// components must import them from @/domain/enums/PasswordReset directly —
// this module pulls in bcrypt and nodemailer.
export { ResetRequestOutcome, ResetTokenState };

/**
 * PasswordResetService — the "ลืมรหัสผ่าน" flow, end to end.
 *
 * WHY THIS SERVICE TAKES ITS REPOSITORIES AS CONSTRUCTOR ARGUMENTS.
 * Every other auth service reaches into the `@/repositories` singleton
 * registry, which is Postgres-backed, which is why four service suites sit in
 * jest's `testPathIgnorePatterns` — they cannot run without a live database.
 * This one is injectable, so its rules (who gets a link, which links are
 * accepted, what a spent link does) are covered by ordinary unit tests. The
 * app still gets a ready-made singleton at the bottom of this file.
 *
 * ACCOUNT-EXISTENCE DISCLOSURE IS DELIBERATE HERE.
 * `EmailVerificationService.resend()` returns silent success for an unknown
 * address specifically so the endpoint cannot be used to enumerate accounts.
 * This flow was specified the other way round: the user must be told whether
 * the address is registered, separately from whether the mail went out, so a
 * typo'd address is diagnosable instead of a silent dead end. The outcome
 * union below keeps those two facts distinct precisely because the UI has to
 * report both. If enumeration ever becomes a concern, collapse
 * `UnknownEmail` into `Sent` at the ROUTE layer and leave this service alone.
 */

/** How long a reset link stays usable. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** Minimum gap between two reset emails to the same address. */
export const RESET_REQUEST_COOLDOWN_SECONDS = 60;

export interface ResetRequestResult {
  outcome: ResetRequestOutcome;
  /** Providers the account actually uses — only set for SocialOnly. */
  providers?: AuthProvider[];
  /** Provider-side detail for the server log — never shown to the user. */
  detail?: string;
}

export interface ResetTokenCheck {
  state: ResetTokenState;
  /** Masked for display, e.g. `jo••@gmail.com`. Only set when Valid. */
  maskedEmail?: string;
}

export interface PasswordResetDeps {
  users: IUserRepository;
  identities: IAuthIdentityRepository;
  tokens: IPasswordResetTokenRepository;
  /** Injectable so tests never touch the network. */
  sendMail?: typeof sendEmail;
  now?: () => Date;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** `joe.smith@gmail.com` → `jo••••••@gmail.com`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function buildResetEmail(link: string, name: string): { html: string; text: string } {
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1e293b">
      <h2 style="margin-bottom:8px">ตั้งรหัสผ่านใหม่ / Reset your password</h2>
      <p style="color:#475569;margin-bottom:24px">
        สวัสดีคุณ ${name}<br/>
        เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี RClipper ของคุณ
        กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่
      </p>
      <p style="margin:24px 0">
        <a href="${link}"
           style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;display:inline-block">
          ตั้งรหัสผ่านใหม่
        </a>
      </p>
      <p style="color:#475569;font-size:12px;word-break:break-all">
        หากปุ่มใช้งานไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br/>
        <a href="${link}" style="color:#1d4ed8">${link}</a>
      </p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">
        ลิงก์นี้ใช้ได้ ${RESET_TOKEN_TTL_MINUTES} นาที และใช้ได้เพียงครั้งเดียว<br/>
        หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลฉบับนี้ — รหัสผ่านเดิมของคุณยังใช้งานได้ตามปกติ
      </p>
    </div>
  `;

  const text = [
    `สวัสดีคุณ ${name}`,
    "",
    "ตั้งรหัสผ่านใหม่สำหรับบัญชี RClipper ของคุณได้ที่ลิงก์นี้:",
    link,
    "",
    `ลิงก์นี้ใช้ได้ ${RESET_TOKEN_TTL_MINUTES} นาที และใช้ได้เพียงครั้งเดียว`,
    "หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลฉบับนี้",
  ].join("\n");

  return { html, text };
}

export class PasswordResetService {
  private readonly users: IUserRepository;
  private readonly identities: IAuthIdentityRepository;
  private readonly tokens: IPasswordResetTokenRepository;
  private readonly sendMail: typeof sendEmail;
  private readonly now: () => Date;

  /** Last send per lowercased email — the cooldown gate. */
  private readonly lastSentAt = new Map<string, number>();

  constructor(deps: PasswordResetDeps) {
    this.users = deps.users;
    this.identities = deps.identities;
    this.tokens = deps.tokens;
    this.sendMail = deps.sendMail ?? sendEmail;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Step 1 — the user typed their email on /forgot-password.
   *
   * Checks the address against the register FIRST, and only then attempts
   * delivery, so the caller can report the two results separately.
   *
   * An unverified account is allowed through on purpose: clicking a link that
   * arrived in that inbox proves ownership at least as well as the six-digit
   * signup code does, so completing a reset also marks the email verified
   * (see `confirmReset`). Without that, a user who never verified and then
   * forgot their password would be permanently locked out.
   */
  async requestReset(
    email: string,
    options: { resetUrl: (token: string) => string }
  ): Promise<ResetRequestResult> {
    const normalised = email.toLowerCase().trim();

    const user = await this.users.findByEmail(normalised);
    if (!user || user.deletedAt) {
      return { outcome: ResetRequestOutcome.UnknownEmail };
    }

    // A password can only be reset if there is a password to reset. Accounts
    // created through Google/Apple have a credentials row only if they also
    // registered by email, so check for the hash, not just the row.
    const credentials = await this.identities.findCredentialsByUserId(user.id);
    if (!credentials?.passwordHash) {
      const all = await this.identities.findByUserId(user.id);
      const providers = all
        .map((i) => i.provider)
        .filter((p) => p !== AuthProvider.Credentials);
      return {
        outcome: ResetRequestOutcome.SocialOnly,
        providers: providers.length > 0 ? providers : [AuthProvider.Google],
      };
    }

    const last = this.lastSentAt.get(normalised);
    const nowMs = this.now().getTime();
    if (last && nowMs - last < RESET_REQUEST_COOLDOWN_SECONDS * 1000) {
      return { outcome: ResetRequestOutcome.Throttled };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(nowMs + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    // Requesting a new link retires every older one, so a forwarded or
    // shoulder-surfed earlier email stops working the moment the real owner
    // asks again.
    await this.tokens.invalidateUnusedForUser(user.id);
    await this.tokens.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });

    const { html, text } = buildResetEmail(
      options.resetUrl(rawToken),
      user.name
    );

    try {
      await this.sendMail({
        to: user.email,
        subject: "ตั้งรหัสผ่านใหม่สำหรับบัญชี RClipper",
        html,
        text,
      });
    } catch (error) {
      // The token stays in the table but is unreachable — nobody has the raw
      // value. The user simply tries again.
      return {
        outcome: ResetRequestOutcome.EmailFailed,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    this.lastSentAt.set(normalised, nowMs);
    return { outcome: ResetRequestOutcome.Sent };
  }

  /**
   * Step 2 — the user opened the link. Called before the form renders so a
   * dead link says so immediately instead of after they type a password.
   */
  async checkToken(rawToken: string): Promise<ResetTokenCheck> {
    const record = await this.tokens.findByTokenHash(hashToken(rawToken));
    if (!record) return { state: ResetTokenState.Invalid };
    if (record.usedAt) return { state: ResetTokenState.Used };
    if (this.now() > record.expiresAt) return { state: ResetTokenState.Expired };

    const user = await this.users.findById(record.userId);
    if (!user || user.deletedAt) return { state: ResetTokenState.Invalid };

    return { state: ResetTokenState.Valid, maskedEmail: maskEmail(user.email) };
  }

  /**
   * Step 3 — the user submitted a new password.
   *
   * Order matters: the token is burned only after the new hash is written, so
   * a failure mid-flight leaves the link usable rather than stranding the user
   * with a spent token and the old password.
   */
  async confirmReset(
    rawToken: string,
    newPassword: string
  ): Promise<ResetTokenCheck> {
    const record = await this.tokens.findByTokenHash(hashToken(rawToken));
    if (!record) return { state: ResetTokenState.Invalid };
    if (record.usedAt) return { state: ResetTokenState.Used };
    if (this.now() > record.expiresAt) return { state: ResetTokenState.Expired };

    const user = await this.users.findById(record.userId);
    if (!user || user.deletedAt) return { state: ResetTokenState.Invalid };

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.identities.updatePasswordHash(user.id, passwordHash);

    // Reaching this point required reading an email at that address.
    if (!user.emailVerified) {
      await this.users.markEmailVerified(user.id);
    }

    await this.tokens.markUsed(record.id);
    // Any other outstanding link is now stale.
    await this.tokens.invalidateUnusedForUser(user.id);

    return { state: ResetTokenState.Valid, maskedEmail: maskEmail(user.email) };
  }
}

/**
 * App-wide instance, wired to the Postgres registry.
 *
 * Built lazily: importing `@/repositories` at module scope would drag the
 * whole Postgres registry into any test that imports this file.
 */
let singleton: PasswordResetService | undefined;

export async function getPasswordResetService(): Promise<PasswordResetService> {
  if (!singleton) {
    const {
      userRepository,
      authIdentityRepository,
      passwordResetTokenRepository,
    } = await import("@/repositories");
    singleton = new PasswordResetService({
      users: userRepository,
      identities: authIdentityRepository,
      tokens: passwordResetTokenRepository,
    });
  }
  return singleton;
}
