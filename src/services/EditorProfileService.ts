import { editorProfileRepository } from "@/repositories";
import {
  EditorProfile,
  CreateEditorProfileInput,
  UpdateEditorProfileInput,
} from "@/domain/models/EditorProfile";

export class EditorProfileService {
  /** All active + approved profiles for marketplace browse. AI Editor is always first. */
  async getAll(): Promise<EditorProfile[]> {
    return editorProfileRepository.findAll();
  }

  async getById(id: string): Promise<EditorProfile> {
    const profile = await editorProfileRepository.findById(id);
    if (!profile) throw new Error(`Editor profile not found: ${id}`);
    return profile;
  }

  async getByUserId(userId: string): Promise<EditorProfile | null> {
    return editorProfileRepository.findByUserId(userId);
  }

  async getAIEditor(): Promise<EditorProfile> {
    const profile = await editorProfileRepository.findAIEditor();
    if (!profile) throw new Error("AI Editor profile not found. Run seed data.");
    return profile;
  }

  /** Admin: all profiles regardless of approval/active state. */
  async getAllForAdmin(): Promise<EditorProfile[]> {
    return editorProfileRepository.findAllForAdmin();
  }

  /** Admin: create a new editor profile (human or AI). */
  async create(input: CreateEditorProfileInput): Promise<EditorProfile> {
    return editorProfileRepository.create(input);
  }

  /** Admin: update an editor profile. */
  async update(id: string, input: UpdateEditorProfileInput): Promise<EditorProfile> {
    await this.getById(id);
    return editorProfileRepository.update(id, input);
  }

  /** Admin: approve an editor so they appear on the marketplace. */
  async approve(id: string): Promise<EditorProfile> {
    await this.getById(id);
    return editorProfileRepository.update(id, { isApproved: true, isActive: true });
  }

  /** Admin: deactivate an editor (hides from marketplace, keeps history). */
  async deactivate(id: string): Promise<EditorProfile> {
    await this.getById(id);
    return editorProfileRepository.update(id, { isActive: false });
  }

  /**
   * Called after a requester submits a review.
   * Recalculates avgRating from the stored aggregate.
   */
  async recordCompletedRequest(
    editorProfileId: string,
    rating: number
  ): Promise<EditorProfile> {
    const profile = await this.getById(editorProfileId);
    const newTotal = profile.totalReviews + 1;
    const newCompleted = profile.totalCompleted + 1;
    const newAvg =
      (profile.avgRating * profile.totalReviews + rating) / newTotal;

    return editorProfileRepository.update(editorProfileId, {
      totalReviews: newTotal,
      totalCompleted: newCompleted,
      avgRating: Math.round(newAvg * 10) / 10,
    });
  }
}

export const editorProfileService = new EditorProfileService();
