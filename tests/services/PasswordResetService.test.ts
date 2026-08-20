/**
 * PasswordResetService tests — the "ลืมรหัสผ่าน" flow.
 *
 * Covers the rules that matter and are easy to regress:
 * - the email-exists check is reported separately from the send result
 * - Google/Apple-only accounts are refused (there is no password to reset)
 * - a link is single-use, expires, and is superseded by a newer request
 * - completing a reset actually changes the hash the login path compares
 * - an unverified account becomes verified by completing a reset
 *
 * Runs entirely on mock repositories with an injected mailer — no DB, no SMTP.
 */

import bcrypt from "bcryptjs";
import {
  PasswordResetService,
  RESET_TOKEN_TTL_MINUTES,
  maskEmail,
} from "@/services/PasswordResetService";
import {
  ResetRequestOutcome,
  ResetTokenState,
} from "@/domain/enums/PasswordReset";
import { MockUserRepository } from "@/repositories/mock/MockUserRepository";
import { MockAuthIdentityRepository } from "@/repositories/mock/MockAuthIdentityRepository";
import { MockPasswordResetTokenRepository } from "@/repositories/mock/MockPasswordResetTokenRepository";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";

const OLD_PASSWORD = "OldPass123";
const NEW_PASSWORD = "BrandNew456";

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function buildHarness(options?: { failMail?: boolean; now?: () => Date }) {
  const users = new MockUserRepository(new Map());
  const identities = new MockAuthIdentityRepository(new Map());
  const tokens = new MockPasswordResetTokenRepository(new Map());
  const sent: SentMail[] = [];

  const service = new PasswordResetService({
    users,
    identities,
    tokens,
    now: options?.now,
    sendMail: async (mail) => {
      if (options?.failMail) throw new Error("Brevo API request failed (401)");
      sent.push(mail as SentMail);
    },
  });

  // The link the service hands to the mailer; tests pull the raw token back
  // out of it exactly the way a user's browser would.
  const resetUrl = (token: string) =>
    `https://rclipper.com/reset-password?token=${token}`;

  async function createCredentialsUser(
    email: string,
    opts?: { emailVerified?: boolean }
  ) {
    const user = await users.create({
      email,
      name: "Test User",
      role: Role.Requester,
      emailVerified: opts?.emailVerified ?? true,
      trialConsumed: false,
    });
    await identities.create({
      userId: user.id,
      provider: AuthProvider.Credentials,
      providerAccountId: null,
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 10),
    });
    return user;
  }

  async function createGoogleUser(email: string) {
    const user = await users.create({
      email,
      name: "Google User",
      role: Role.Requester,
      emailVerified: true,
      trialConsumed: false,
    });
    await identities.create({
      userId: user.id,
      provider: AuthProvider.Google,
      providerAccountId: "google-sub-1",
      passwordHash: null,
    });
    return user;
  }

  function lastTokenFromMail(): string {
    const link = sent[sent.length - 1].text.match(
      /reset-password\?token=([a-f0-9]+)/
    );
    if (!link) throw new Error("No reset link in the sent email");
    return link[1];
  }

  return {
    service,
    users,
    identities,
    tokens,
    sent,
    resetUrl,
    createCredentialsUser,
    createGoogleUser,
    lastTokenFromMail,
  };
}

describe("PasswordResetService.requestReset — the email check", () => {
  it("reports UnknownEmail and sends nothing for an unregistered address", async () => {
    const h = await buildHarness();
    const result = await h.service.requestReset("nobody@example.com", {
      resetUrl: h.resetUrl,
    });

    expect(result.outcome).toBe(ResetRequestOutcome.UnknownEmail);
    expect(h.sent).toHaveLength(0);
  });

  it("treats a deleted account as unregistered", async () => {
    const h = await buildHarness();
    const user = await h.createCredentialsUser("gone@example.com");
    await h.users.anonymizeAndSoftDelete(user.id);

    const result = await h.service.requestReset("gone@example.com", {
      resetUrl: h.resetUrl,
    });

    expect(result.outcome).toBe(ResetRequestOutcome.UnknownEmail);
    expect(h.sent).toHaveLength(0);
  });

  it("refuses a Google-only account and names the provider", async () => {
    const h = await buildHarness();
    await h.createGoogleUser("social@example.com");

    const result = await h.service.requestReset("social@example.com", {
      resetUrl: h.resetUrl,
    });

    expect(result.outcome).toBe(ResetRequestOutcome.SocialOnly);
    expect(result.providers).toEqual([AuthProvider.Google]);
    expect(h.sent).toHaveLength(0);
  });

  it("matches the address case-insensitively", async () => {
    const h = await buildHarness();
    await h.createCredentialsUser("Mixed@Example.com");

    const result = await h.service.requestReset("  MIXED@example.COM  ", {
      resetUrl: h.resetUrl,
    });

    expect(result.outcome).toBe(ResetRequestOutcome.Sent);
  });
});

describe("PasswordResetService.requestReset — the send", () => {
  it("sends a link to a registered credentials account", async () => {
    const h = await buildHarness();
    await h.createCredentialsUser("user@example.com");

    const result = await h.service.requestReset("user@example.com", {
      resetUrl: h.resetUrl,
    });

    expect(result.outcome).toBe(ResetRequestOutcome.Sent);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("user@example.com");
    expect(h.sent[0].text).toContain("reset-password?token=");
  });

  it("reports EmailFailed — account found, delivery did not happen", async () => {
    const h = await buildHarness({ failMail: true });
    await h.createCredentialsUser("user@example.com");

    const result = await h.service.requestReset("user@example.com", {
      resetUrl: h.resetUrl,
    });

    // The two facts stay distinct: the address WAS found, the mail was not sent.
    expect(result.outcome).toBe(ResetRequestOutcome.EmailFailed);
    expect(result.outcome).not.toBe(ResetRequestOutcome.UnknownEmail);
    expect(h.sent).toHaveLength(0);
  });

  it("never stores the raw token — only its hash", async () => {
    const h = await buildHarness();
    await h.createCredentialsUser("user@example.com");
    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });

    const raw = h.lastTokenFromMail();
    const stored = await h.tokens.findByTokenHash(raw);
    expect(stored).toBeNull(); // the raw value is not a key in the table
  });

  it("throttles a second request inside the cooldown", async () => {
    const h = await buildHarness();
    await h.createCredentialsUser("user@example.com");

    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });
    const second = await h.service.requestReset("user@example.com", {
      resetUrl: h.resetUrl,
    });

    expect(second.outcome).toBe(ResetRequestOutcome.Throttled);
    expect(h.sent).toHaveLength(1);
  });
});

describe("PasswordResetService.checkToken", () => {
  it("accepts a fresh token and returns a masked address", async () => {
    const h = await buildHarness();
    await h.createCredentialsUser("someone@example.com");
    await h.service.requestReset("someone@example.com", { resetUrl: h.resetUrl });

    const check = await h.service.checkToken(h.lastTokenFromMail());

    expect(check.state).toBe(ResetTokenState.Valid);
    expect(check.maskedEmail).toBe("so•••••@example.com");
    expect(check.maskedEmail).not.toContain("someone");
  });

  it("rejects a token that was never issued", async () => {
    const h = await buildHarness();
    const check = await h.service.checkToken("deadbeef");
    expect(check.state).toBe(ResetTokenState.Invalid);
  });

  it("rejects a token past its TTL", async () => {
    let clock = new Date("2026-08-16T10:00:00Z");
    const h = await buildHarness({ now: () => clock });
    await h.createCredentialsUser("user@example.com");
    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });
    const token = h.lastTokenFromMail();

    clock = new Date(
      clock.getTime() + (RESET_TOKEN_TTL_MINUTES + 1) * 60 * 1000
    );

    expect((await h.service.checkToken(token)).state).toBe(
      ResetTokenState.Expired
    );
  });

  it("invalidates the earlier link when a newer one is requested", async () => {
    let clock = new Date("2026-08-16T10:00:00Z");
    const h = await buildHarness({ now: () => clock });
    await h.createCredentialsUser("user@example.com");

    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });
    const firstToken = h.lastTokenFromMail();

    clock = new Date(clock.getTime() + 5 * 60 * 1000); // clear the cooldown
    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });
    const secondToken = h.lastTokenFromMail();

    expect(secondToken).not.toBe(firstToken);
    expect((await h.service.checkToken(firstToken)).state).toBe(
      ResetTokenState.Used
    );
    expect((await h.service.checkToken(secondToken)).state).toBe(
      ResetTokenState.Valid
    );
  });
});

describe("PasswordResetService.confirmReset", () => {
  it("replaces the password hash the login path compares against", async () => {
    const h = await buildHarness();
    const user = await h.createCredentialsUser("user@example.com");
    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });

    const result = await h.service.confirmReset(
      h.lastTokenFromMail(),
      NEW_PASSWORD
    );
    expect(result.state).toBe(ResetTokenState.Valid);

    const identity = await h.identities.findCredentialsByUserId(user.id);
    expect(await bcrypt.compare(NEW_PASSWORD, identity!.passwordHash!)).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, identity!.passwordHash!)).toBe(false);
  });

  it("burns the link — a second use is refused", async () => {
    const h = await buildHarness();
    await h.createCredentialsUser("user@example.com");
    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });
    const token = h.lastTokenFromMail();

    await h.service.confirmReset(token, NEW_PASSWORD);
    const replay = await h.service.confirmReset(token, "Another999");

    expect(replay.state).toBe(ResetTokenState.Used);
  });

  it("leaves the old password working if the link is not valid", async () => {
    const h = await buildHarness();
    const user = await h.createCredentialsUser("user@example.com");

    const result = await h.service.confirmReset("not-a-real-token", NEW_PASSWORD);

    expect(result.state).toBe(ResetTokenState.Invalid);
    const identity = await h.identities.findCredentialsByUserId(user.id);
    expect(await bcrypt.compare(OLD_PASSWORD, identity!.passwordHash!)).toBe(true);
  });

  it("verifies an unverified account — reading the email proved ownership", async () => {
    const h = await buildHarness();
    const user = await h.createCredentialsUser("unverified@example.com", {
      emailVerified: false,
    });
    await h.service.requestReset("unverified@example.com", {
      resetUrl: h.resetUrl,
    });

    await h.service.confirmReset(h.lastTokenFromMail(), NEW_PASSWORD);

    // Without this the user could set a password and still be refused at
    // login by the EmailNotVerified gate in AuthService.
    expect((await h.users.findById(user.id))!.emailVerified).toBe(true);
  });

  it("refuses an expired link", async () => {
    let clock = new Date("2026-08-16T10:00:00Z");
    const h = await buildHarness({ now: () => clock });
    await h.createCredentialsUser("user@example.com");
    await h.service.requestReset("user@example.com", { resetUrl: h.resetUrl });
    const token = h.lastTokenFromMail();

    clock = new Date(
      clock.getTime() + (RESET_TOKEN_TTL_MINUTES + 1) * 60 * 1000
    );

    expect((await h.service.confirmReset(token, NEW_PASSWORD)).state).toBe(
      ResetTokenState.Expired
    );
  });
});

describe("maskEmail", () => {
  it("keeps the first two characters and the domain", () => {
    expect(maskEmail("joe.smith@gmail.com")).toBe("jo•••••••@gmail.com");
  });

  it("never returns an empty mask for a very short local part", () => {
    expect(maskEmail("ab@x.com")).toBe("ab•@x.com");
  });

  it("passes through a value that is not an address", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});
