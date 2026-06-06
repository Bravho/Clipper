import { businessProfileRepository } from "@/repositories/index";
import { CreateBusinessProfileInput, UpdateBusinessProfileInput } from "@/domain/models/BusinessProfile";

export class BusinessProfileService {
  async getProfile(userId: string) {
    return businessProfileRepository.findByUserId(userId);
  }

  async saveProfile(userId: string, input: Omit<CreateBusinessProfileInput, "userId">) {
    const existing = await businessProfileRepository.findByUserId(userId);
    if (existing) {
      return businessProfileRepository.update(userId, input);
    } else {
      return businessProfileRepository.create({
        ...input,
        userId,
      });
    }
  }
}

export const businessProfileService = new BusinessProfileService();
