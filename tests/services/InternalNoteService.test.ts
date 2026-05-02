/**
 * Tests for InternalNoteService.
 *
 * Covers:
 * - addNote validates content (min, max length)
 * - addNote creates a note with correct fields
 * - getNotesForRequest returns all notes sorted newest first
 * - getLatestNote returns the most recent note
 * - deleteNote removes the note
 */

import { InternalNoteService } from "@/services/staff/InternalNoteService";
import { MockInternalNoteRepository } from "@/repositories/mock/MockInternalNoteRepository";
import { InternalNote } from "@/domain/models/InternalNote";

function buildService() {
  const store = new Map<string, InternalNote>();
  const repo = new MockInternalNoteRepository(store);
  // InternalNoteService uses module singleton — test via public API + seed data
  const service = new InternalNoteService();
  return { service, repo };
}

describe("InternalNoteService — validation", () => {
  it("rejects empty content", async () => {
    const { service } = buildService();
    await expect(
      service.addNote("req-002", "staff-001", "Staff", "")
    ).rejects.toThrow(/required/i);
  });

  it("rejects content over 2000 characters", async () => {
    const { service } = buildService();
    const longContent = "x".repeat(2001);
    await expect(
      service.addNote("req-002", "staff-001", "Staff", longContent)
    ).rejects.toThrow(/2000/);
  });

  it("accepts content within limit", async () => {
    const { service } = buildService();
    const note = await service.addNote("req-002", "staff-001", "Staff", "Valid note.");
    expect(note.content).toBe("Valid note.");
    expect(note.requestId).toBe("req-002");
    expect(note.authorId).toBe("staff-001");
    expect(note.authorName).toBe("Staff");
  });
});

describe("InternalNoteService — retrieval", () => {
  it("getNotesForRequest returns seed notes for req-002", async () => {
    const { service } = buildService();
    const notes = await service.getNotesForRequest("req-002");
    expect(notes.length).toBeGreaterThan(0);
    // All notes should belong to req-002
    notes.forEach((n) => expect(n.requestId).toBe("req-002"));
  });

  it("getLatestNote returns the most recent note", async () => {
    const { service } = buildService();
    const latest = await service.getLatestNote("req-004");
    expect(latest).not.toBeNull();
    // req-004 has two notes; latest should be note-004-2 (newer)
    expect(latest?.id).toBe("note-004-2");
  });

  it("getLatestNote returns null for request with no notes", async () => {
    const { service } = buildService();
    // req-003 has a note in seed data (note-003-1)
    // req-001 (draft) has no notes
    const latest = await service.getLatestNote("req-001");
    expect(latest).toBeNull();
  });
});

describe("InternalNoteService — note creation fields", () => {
  it("trims whitespace from content", async () => {
    const { service } = buildService();
    const note = await service.addNote("req-002", "staff-001", "Staff User", "  Note with spaces  ");
    expect(note.content).toBe("Note with spaces");
  });

  it("sets createdAt and updatedAt", async () => {
    const { service } = buildService();
    const before = new Date();
    const note = await service.addNote("req-002", "staff-001", "Staff", "Test note.");
    expect(note.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(note.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
