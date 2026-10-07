/**
 * LINE Official Account friend-count reader for Chinese_TTT Analyze.
 * Read-only. Stub when AD_LAB_LINE_OA_CHANNEL_ACCESS_TOKEN is missing.
 */

import { AD_LAB_LINE_OA, lineOaConfigured } from "@/config/adLabIntegrations";

export interface LineFriendSnapshot {
  stub: boolean;
  friendCount: number;
  capturedAt: string;
  message: string;
  raw?: unknown;
}

export async function fetchLineFriendCount(): Promise<LineFriendSnapshot> {
  const capturedAt = new Date().toISOString();
  if (!lineOaConfigured()) {
    return {
      stub: true,
      friendCount: 0,
      capturedAt,
      message:
        "LINE OA token missing — set AD_LAB_LINE_OA_CHANNEL_ACCESS_TOKEN. Showing stub (0). No write calls were made.",
    };
  }

  const day = capturedAt.slice(0, 10).replace(/-/g, "");
  const url = "https://api.line.me/v2/bot/insight/followers?date=" + day;
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + AD_LAB_LINE_OA.channelAccessToken },
  });
  const data = (await response.json().catch(() => ({}))) as {
    status?: string;
    followers?: number;
    targetedReaches?: number;
    blocks?: number;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(data.message || ("LINE insight/followers failed (" + response.status + ")"));
  }

  const friendCount = Number(data.followers ?? 0) || 0;
  return {
    stub: false,
    friendCount,
    capturedAt,
    message: "LINE OA friend count loaded.",
    raw: data,
  };
}

export { lineOaConfigured };
