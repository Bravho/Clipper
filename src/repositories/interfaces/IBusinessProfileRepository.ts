import { BusinessProfile, CreateBusinessProfileInput, UpdateBusinessProfileInput } from "@/domain/models/BusinessProfile";

export interface IBusinessProfileRepository {
  findByUserId(userId: string): Promise<BusinessProfile | null>;
  create(input: CreateBusinessProfileInput): Promise<BusinessProfile>;
  update(userId: string, data: UpdateBusinessProfileInput): Promise<BusinessProfile>;
  upsert(userId: string, input: CreateBusinessProfileInput): Promise<BusinessProfile>;
}
