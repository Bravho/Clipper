/**
 * Shared service instance wired with real dependencies for the avatar API
 * routes. Keeps the routes thin: they only validate input, call the service,
 * and translate errors to HTTP responses.
 *
 * loadDraft is read-only — it never writes the workspace.
 */

import { AdLabAvatarService } from "@/services/ad-lab/AdLabAvatarService";
import { adLabWorkspaceRepository } from "@/repositories";

export const avatarService = new AdLabAvatarService({
  loadDraft: async (ownerId, draftId) => {
    const result = await adLabWorkspaceRepository.findByOwnerId(ownerId);
    return result.store?.drafts.find((d) => d.id === draftId) ?? null;
  },
});
