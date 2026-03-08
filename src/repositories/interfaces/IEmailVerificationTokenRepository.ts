import {
  EmailVerificationToken,
  CreateEmailVerificationTokenInput,
} from "@/domain/models/EmailVerificationToken";

export interface IEmailVerificationTokenRepository {
  create(input: CreateEmailVerificationTokenInput): Promise<EmailVerificationToken>;
  findByTokenHash(tokenHash: string): Promise<EmailVerificationToken | null>;
  markUsed(id: string): Promise<void>;
}
