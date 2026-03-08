import crypto from "crypto";
import { emailVerificationTokenRepository, userRepository } from "@/repositories";
import { sendEmail } from "@/lib/email";

const TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildVerificationEmail(verificationUrl: string, name: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1e293b">
      <h2 style="margin-bottom:8px">Verify your email address</h2>
      <p style="color:#475569;margin-bottom:24px">
        Hi ${name}, thanks for signing up for Clipper.<br/>
        Click the button below to verify your email address and activate your account.
      </p>
      <a href="${verificationUrl}"
         style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">
        Verify email address
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">
        This link expires in ${TOKEN_TTL_HOURS} hours.<br/>
        If you didn&rsquo;t create a Clipper account, you can safely ignore this email.
      </p>
    </div>
  `;
}

export class EmailVerificationService {
  async generateAndSend(userId: string, email: string, name: string): Promise<void> {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await emailVerificationTokenRepository.create({ userId, tokenHash, expiresAt });

    const verificationUrl = `${process.env.APP_URL}/verify-email/confirm?token=${rawToken}`;

    await sendEmail({
      to: email,
      subject: "Verify your Clipper account email",
      html: buildVerificationEmail(verificationUrl, name),
      text: `Hi ${name},\n\nVerify your Clipper account by visiting:\n${verificationUrl}\n\nThis link expires in ${TOKEN_TTL_HOURS} hours.`,
    });
  }

  async verify(rawToken: string): Promise<{ success: boolean; error?: string }> {
    const tokenHash = hashToken(rawToken);
    const record = await emailVerificationTokenRepository.findByTokenHash(tokenHash);

    if (!record) {
      return { success: false, error: "Invalid or expired verification link." };
    }
    if (record.usedAt) {
      return { success: false, error: "This verification link has already been used." };
    }
    if (new Date() > record.expiresAt) {
      return { success: false, error: "This verification link has expired. Please request a new one." };
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
