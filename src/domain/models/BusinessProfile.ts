export interface BusinessProfile {
  id: string;
  userId: string;
  businessName: string;
  category: string;
  location: string | null;
  description: string | null;
  menuDetails: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateBusinessProfileInput = {
  userId: string;
  businessName: string;
  category: string;
  location?: string | null;
  description?: string | null;
  menuDetails?: string | null;
};

export type UpdateBusinessProfileInput = Partial<
  Omit<BusinessProfile, "id" | "userId" | "createdAt" | "updatedAt">
>;
