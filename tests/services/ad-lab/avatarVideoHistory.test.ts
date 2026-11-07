import { legacyVideoFromEntry, removeAvatarVideo } from "@/services/ad-lab/avatarVideoHistory";
import type { AdLabAvatarVideoEntry, AdLabDraftAvatar } from "@/domain/models/AdLab";

const ready: AdLabAvatarVideoEntry = {
  id: "first", idempotencyKey: "first-job", heygenVideoId: "first-provider",
  videoKey: "first.mp4", kind: "test", voiceSource: "twin_tts", lookId: "look",
  engine: "avatar_v", status: "ready", estCostUsd: 1, attempts: 1,
  createdAt: "2026-10-13", updatedAt: "2026-10-13",
};
const failed: AdLabAvatarVideoEntry = { ...ready, id: "second", idempotencyKey: "second-job", heygenVideoId: undefined, videoKey: undefined, status: "failed" };
const avatar: AdLabDraftAvatar = { scriptHash: "hash", updatedAt: "old", videos: [ready, failed], primaryVideoId: ready.id, video: legacyVideoFromEntry(ready) };

describe("avatar video deletion", () => {
  it("removes the second failed entry while preserving the first playable video and publishing selection", () => {
    const result = removeAvatarVideo(avatar, failed.id, "now");
    expect(result.videos).toEqual([ready]);
    expect(result.primaryVideoId).toBe(ready.id);
    expect(result.video?.videoKey).toBe("first.mp4");
    expect(avatar.videos).toHaveLength(2);
  });
  it("clears deleted primary media without removing another video's details", () => {
    const result = removeAvatarVideo(avatar, ready.id, "now");
    expect(result.videos).toEqual([failed]);
    expect(result.video).toBeUndefined();
    expect(result.primaryVideoId).toBeUndefined();
  });
  it("keeps an explicit empty history after the last deletion, including a legacy-only draft", () => {
    expect(removeAvatarVideo({ ...avatar, videos: [ready] }, ready.id, "now").videos).toEqual([]);
    const result = removeAvatarVideo({ ...avatar, videos: undefined }, ready.id, "now");
    expect(result.videos).toEqual([]);
    expect(result.video).toBeUndefined();
  });
  it("moves publishing to a surviving ready entry with all identifiers from that entry", () => {
    const other = { ...ready, id: "other", idempotencyKey: "other-job", heygenVideoId: "other-provider", videoKey: "other.mp4" };
    const result = removeAvatarVideo({ ...avatar, videos: [ready, other] }, ready.id, "now");
    expect(result.primaryVideoId).toBe(other.id);
    expect(result.video).toEqual(legacyVideoFromEntry(other));
  });
});
