import { InternalNote } from "@/domain/models/InternalNote";
import { internalNoteRepository } from "@/repositories";
import { z } from "zod";

/**
 * InternalNoteService — creates and retrieves staff-internal notes for requests.
 *
 * Business rules:
 * - Notes are NEVER exposed to requesters. Staff and admin only.
 * - Each note is immutable once created (no edit support in Phase 2C).
 * - Notes are ordered newest-first on list pages.
 * - The most recent note appears as a summary on queue list pages.
 *
 * TODO: Admin Portal — admins should be able to see all notes, and optionally
 *   delete any note (staff can only delete their own in future).
 *
 * TODO: PostgreSQL — the IInternalNoteRepository swap is sufficient.
 *   No service logic changes needed.
 */

export const createNoteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Note content is required.")
    .max(2000, "Notes cannot exceed 2000 characters."),
});

export class InternalNoteService {
  /**
   * Add a new internal note to a request.
   */
  async addNote(
    requestId: string,
    authorId: string,
    authorName: string,
    content: string
  ): Promise<InternalNote> {
    const parsed = createNoteSchema.safeParse({ content });
    if (!parsed.success) {
      throw new Error(parsed.error.errors[0]?.message ?? "Invalid note.");
    }

    return internalNoteRepository.create({
      requestId,
      authorId,
      authorName,
      content: parsed.data.content,
    });
  }

  /**
   * Get all notes for a request, newest first.
   * For use on the request detail page.
   */
  async getNotesForRequest(requestId: string): Promise<InternalNote[]> {
    return internalNoteRepository.findByRequestId(requestId);
  }

  /**
   * Get the most recent note for a request.
   * For use on queue list pages as a summary.
   */
  async getLatestNote(requestId: string): Promise<InternalNote | null> {
    return internalNoteRepository.findLatestByRequestId(requestId);
  }

  /**
   * Delete a note.
   * Caller must verify ownership before calling this.
   */
  async deleteNote(noteId: string): Promise<void> {
    return internalNoteRepository.delete(noteId);
  }
}

// Singleton instance
export const internalNoteService = new InternalNoteService();
