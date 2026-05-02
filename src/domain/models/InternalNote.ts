/**
 * InternalNote — staff-only notes attached to a clip request.
 *
 * Internal notes are NEVER visible to requesters.
 * They are visible to staff and (in a future phase) to admins.
 *
 * Use cases:
 * - Record review decisions / concerns
 * - Log production progress
 * - Track CapCut project status
 * - Communicate hold/rejection rationale internally
 * - Handoff notes between staff members
 *
 * TODO: PostgreSQL — map to `internal_notes` table.
 *   Column mapping:
 *     requestId  → request_id  (FK → clip_requests.id)
 *     authorId   → author_id   (FK → users.id)
 *     authorName → author_name TEXT (denormalized for audit trail)
 *     content    → content     TEXT NOT NULL
 *     createdAt  → created_at  TIMESTAMPTZ DEFAULT now()
 *     updatedAt  → updated_at  TIMESTAMPTZ DEFAULT now()
 *   Index: (request_id, created_at DESC) for efficient note history queries.
 *   IMPORTANT: Never JOIN this table in requester-facing queries.
 */
export interface InternalNote {
  id: string;
  requestId: string;
  /** ID of the staff or admin user who wrote the note. */
  authorId: string;
  /** Denormalized name for display — preserved even if user record changes. */
  authorName: string;
  /** Note body text. Plain text — no markdown required. */
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new internal note. */
export type CreateInternalNoteInput = {
  requestId: string;
  authorId: string;
  authorName: string;
  content: string;
};
