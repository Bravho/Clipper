import {
  DeletedAccountRecord,
  CreateDeletedAccountRecordInput,
} from "@/domain/models/DeletedAccountRecord";

/**
 * Repository contract for the deleted-account fraud-prevention registry.
 *
 * Written once at account deletion; read at signup / OAuth sign-in to detect
 * a returning identity and withhold already-consumed free-trial entitlements.
 */
export interface IDeletedAccountRegistryRepository {
  create(input: CreateDeletedAccountRecordInput): Promise<DeletedAccountRecord>;

  /** All records matching a hashed email (same email may be deleted repeatedly). */
  findByEmailHash(emailHash: string): Promise<DeletedAccountRecord[]>;

  /** All records matching a hashed OAuth provider account id. */
  findByProviderAccountHash(
    providerAccountHash: string
  ): Promise<DeletedAccountRecord[]>;
}
