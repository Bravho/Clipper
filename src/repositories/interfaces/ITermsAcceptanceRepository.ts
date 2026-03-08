import { PolicyType } from "@/domain/enums/PolicyType";
import {
  TermsAcceptance,
  CreateTermsAcceptanceInput,
} from "@/domain/models/TermsAcceptance";

/**
 * Repository contract for TermsAcceptance persistence.
 *
 * TODO: PostgreSQL — implement PostgresTermsAcceptanceRepository.
 *       Records are immutable — never update. Append new records
 *       when policies are re-accepted at new versions.
 */
export interface ITermsAcceptanceRepository {
  findByUserId(userId: string): Promise<TermsAcceptance[]>;
  findLatestByUserIdAndType(
    userId: string,
    policyType: PolicyType
  ): Promise<TermsAcceptance | null>;
  create(input: CreateTermsAcceptanceInput): Promise<TermsAcceptance>;
}
