import crypto from "crypto";
import { emailVerificationTokenRepository, userRepository } from "@/repositories";
import { sendEmail } from "@/lib/email";

const CODE_TTL_MINUTES = 10;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function codeHash(email: string, code: string): string {
  return hashToken(`${email.toLowerCase().trim()}:${code}`);
}

function buildVerificationEmail(code: string, name: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1e293b">
      <h2 style="margin-bottom:8px">Verify your email address</h2>
      <p style="color:#475569;margin-bottom:24px">
        Hi ${name}, thanks for signing up for Clipper.<br/>
        Enter this code in RClipper to verify your email address and activate your account.
      </p>
      <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#1d4ed8;margin:24px 0">
        ${code}
      </div>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">
        This code expires in ${CODE_TTL_MINUTES} minutes.<br/>
        If you didn&rsquo;t create a Clipper account, you can safely ignore this email.
      </p>
    </div>
  `;
}

export class EmailVerificationService {
  async generateAndSend(userId: string, email: string, name: string): Promise<void> {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const tokenHash = codeHash(email, code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await emailVerificationTokenRepository.invalidateUnusedForUser(userId);
    await emailVerificationTokenRepository.create({ userId, tokenHash, expiresAt });

    await sendEmail({
      to: email,
      subject: `${code} is your RClipper verification code`,
      html: buildVerificationEmail(code, name),
      text: `Hi ${name},\n\nYour RClipper verification code is ${code}.\n\nThis code expires in ${CODE_TTL_MINUTES} minutes.`,
    });
  }

  async verify(email: string, code: string): Promise<{ success: boolean; error?: string }> {
    const tokenHash = codeHash(email, code);
    const record = await emailVerificationTokenRepository.findByTokenHash(tokenHash);

    if (!record) {
      return { success: false, error: "Invalid verification code." };
    }
    if (record.usedAt) {
      return { success: false, error: "This verification code has already been used." };
    }
    if (new Date() > record.expiresAt) {
      return { success: false, error: "This verification code has expired. Please request a new one." };
    }

    await emailVerificationTokenRepository.markUsed(record.id);
    await userRepository.markEmailVerified(record.userId);

    return { success: true };
  }

  async resend(email: string): Promise<{ success: boolean; error?: string }> {
    const user = await userRepository.findByEmail(email);
    // Silent success if email not found — don't leak account existence
    if (!user) return { success: true };
    if (user.emailVerified) {
      return { success: false, error: "This email address is already verified." };
    }

    await this.generateAndSend(user.id, user.email, user.name);
    return { success: true };
  }
}

export const emailVerificationService = new EmailVerificationService();
