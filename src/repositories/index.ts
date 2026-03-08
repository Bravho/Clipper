/**
 * Repository registry — single source of repository instances.
 *
 * Services import repositories from here only.
 * All repositories now backed by PostgreSQL (Amazon RDS).
 *
 * To revert to in-memory mocks for isolated unit tests, swap the imports
 * back to the Mock* implementations and pass a fresh Map() to each constructor.
 */
import { PostgresUserRepository } from "./postgres/PostgresUserRepository";
import { PostgresAuthIdentityRepository } from "./postgres/PostgresAuthIdentityRepository";
import { PostgresCreditWalletRepository } from "./postgres/PostgresCreditWalletRepository";
import { PostgresCreditTransactionRepository } from "./postgres/PostgresCreditTransactionRepository";
import { PostgresTermsAcceptanceRepository } from "./postgres/PostgresTermsAcceptanceRepository";

export const userRepository = new PostgresUserRepository();
export const authIdentityRepository = new PostgresAuthIdentityRepository();
export const creditWalletRepository = new PostgresCreditWalletRepository();
export const creditTransactionRepository = new PostgresCreditTransactionRepository();
export const termsAcceptanceRepository = new PostgresTermsAcceptanceRepository();
