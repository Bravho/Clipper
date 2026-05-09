import {
  EditorProfile,
  CreateEditorProfileInput,
  UpdateEditorProfileInput,
} from "@/domain/models/EditorProfile";

export interface IEditorProfileRepository {
  findById(id: string): Promise<EditorProfile | null>;
  findByUserId(userId: string): Promise<EditorProfile | null>;

  /** Returns all active + approved profiles for marketplace display. */
  findAll(): Promise<EditorProfile[]>;

  /** Returns the single AI system editor profile. */
  findAIEditor(): Promise<EditorProfile | null>;

  /** Returns all profiles regardless of approval/active status (admin use). */
  findAllForAdmin(): Promise<EditorProfile[]>;

  create(input: CreateEditorProfileInput): Promise<EditorProfile>;
  update(id: string, input: UpdateEditorProfileInput): Promise<EditorProfile>;
}
