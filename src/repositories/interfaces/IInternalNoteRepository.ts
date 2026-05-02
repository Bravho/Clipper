import {
  InternalNote,
  CreateInternalNoteInput,
} from "@/domain/models/InternalNote";

/**
 * Repository contract for InternalNote persistence.
 *
 * Internal notes are staff-only and MUST NEVER be exposed to requesters.
 *
 * TODO: PostgreSQL — implement PostgresInternalNoteRepository.
 *   Table: `internal_notes`
 *   Columns: id, request_id (FK), author_id (FK), author_name, content, created_at, updated_at
 *   Index: (request_id, created_at DESC) for note history queries.
 *   Index: (author_id) for staff workload queries.
 *   IMPORTANT: Ensure requester-facing API routes never JOIN or SELECT from this table.
 */
export interface IInternalNoteRepository {
  /**
   * Find all notes for a specific request, ordered newest first.
   */
  findByRequestId(requestId: string): Promise<InternalNote[]>;

  /**
   * Get the most recent note for a request.
   * Used on list pages (review queue, editing queue) to show latest context.
   * TODO: PostgreSQL — SELECT * FROM internal_notes WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1
   */
  findLatestByRequestId(requestId: string): Promise<InternalNote | null>;

  /**
   * Find all notes authored by a specific staff member.
   * Future use: staff workload / audit trail.
   */
  findByAuthorId(authorId: string): Promise<InternalNote[]>;

  /** Create a new internal note. */
  create(input: CreateInternalNoteInput): Promise<InternalNote>;

  /**
   * Delete a note by ID.
   * Staff may delete their own notes (admin may delete any note in future phase).
   */
  delete(id: string): Promise<void>;
}
