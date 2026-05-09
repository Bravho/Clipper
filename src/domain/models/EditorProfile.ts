/**
 * Editor profile — represents a marketplace editor (human or AI system).
 *
 * One EditorProfile per editor user. The AI Editor is a special system-owned
 * profile with isAI = true. Human editors are onboarded and approved by admin.
 *
 * TODO: PostgreSQL — map to `editor_profiles` table.
 *   userId FK → users.id (UNIQUE — one profile per user)
 *   specialties TEXT[]
 *   isAI BOOLEAN DEFAULT false
 */
export interface EditorProfile {
  id: string;
  userId: string;

  displayName: string;
  bio: string;
  avatarUrl: string | null;
  portfolioUrl: string | null;

  /** Focus areas shown on the marketplace card, e.g. ["tourism", "restaurant", "hotel"] */
  specialties: string[];

  /** True for the system-owned AI Editor; false for all human editors. */
  isAI: boolean;

  /** Base price in ฿ displayed on the marketplace card. */
  pricePerRequestBaht: number;

  /** Aggregate rating 0–5, updated after each completed request review. */
  avgRating: number;
  totalReviews: number;
  totalCompleted: number;

  /** Admin must approve before the profile appears on the marketplace. */
  isApproved: boolean;

  /** Soft-delete flag — deactivated editors are hidden from marketplace. */
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type CreateEditorProfileInput = Omit<
  EditorProfile,
  "id" | "avgRating" | "totalReviews" | "totalCompleted" | "createdAt" | "updatedAt"
>;

export type UpdateEditorProfileInput = Partial<
  Pick<
    EditorProfile,
    | "displayName"
    | "bio"
    | "avatarUrl"
    | "portfolioUrl"
    | "specialties"
    | "pricePerRequestBaht"
    | "isApproved"
    | "isActive"
    | "avgRating"
    | "totalReviews"
    | "totalCompleted"
  >
>;
