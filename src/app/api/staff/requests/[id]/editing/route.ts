// This route is retained as a placeholder.
// The POST (moveToEditing) and PATCH (CapCut fields) handlers have been removed
// as part of the simplified workflow redesign (Phase 2C).
//
// Status transitions are now handled by:
//   POST /api/staff/requests/[id]/accept-editing  (Submitted/Rejected → Editing)
//   POST /api/staff/requests/[id]/submit-production (Editing → ScheduledForPublishing)
export {};
