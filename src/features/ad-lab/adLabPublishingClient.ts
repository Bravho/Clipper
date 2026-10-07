"use client";

import type { AdLabChannel } from "@/domain/models/AdLab";
import type { AdLabPublication } from "@/domain/models/AdLabPublication";
import type { AdLabAdTargeting, AdLabAdsLink } from "@/domain/models/AdLabAdTargeting";

/** Browser-side calls for Ad Lab real publishing and results. */

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error;
    throw new Error(message || `Request failed (${response.status})`);
  }
  return data as T;
}

/** Upload the video straight to storage, reporting progress 0–100. */
export async function uploadAdLabVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const begin = await readJson<{ uploadUrl: string; videoKey: string }>(
    await fetch("/api/ad-lab/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type || "video/mp4",
      }),
    })
  );

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", begin.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`อัปโหลดไม่สำเร็จ (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("อัปโหลดไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต"));
    xhr.send(file);
  });
  onProgress?.(100);
  return begin.videoKey;
}

export interface PublishRequest {
  brandId: string;
  draftId: string;
  planId?: string | null;
  campaignName: string;
  caption: string;
  title?: string;
  videoKey: string;
  videoName: string;
  targets: Array<{ channel: AdLabChannel; connectionId: string; plannedBudget?: number }>;
}

export async function publishAdLabVideo(input: PublishRequest): Promise<AdLabPublication> {
  const data = await readJson<{ publication: AdLabPublication }>(
    await fetch("/api/ad-lab/publications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
  return data.publication;
}

export async function listAdLabPublications(): Promise<AdLabPublication[]> {
  const data = await readJson<{ publications: AdLabPublication[] }>(
    await fetch("/api/ad-lab/publications", { cache: "no-store" })
  );
  return data.publications;
}

export async function refreshAdLabPublication(
  id: string
): Promise<{ publication: AdLabPublication; warnings: string[] }> {
  return readJson(await fetch(`/api/ad-lab/publications/${encodeURIComponent(id)}/refresh`, { method: "POST" }));
}

export async function updateAdLabTargetEconomics(
  targetId: string,
  values: { spend?: number; revenue?: number; conversions?: number }
): Promise<AdLabPublication> {
  const data = await readJson<{ publication: AdLabPublication }>(
    await fetch(`/api/ad-lab/targets/${encodeURIComponent(targetId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
  );
  return data.publication;
}

/** Delete a failed publication (and its uploaded video) for good. */
export async function deleteAdLabPublication(id: string): Promise<void> {
  const response = await fetch(`/api/ad-lab/publications/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) await readJson(response);
}

/** Create a paused/stub TikTok Ads Manager draft for a published TikTok target. Never enables spend. */
export async function createAdLabAdsDraft(input: {
  targetId: string;
  targeting: AdLabAdTargeting;
  dailyBudgetBaht?: number;
  campaignName?: string;
}): Promise<{ publication: AdLabPublication; link: AdLabAdsLink }> {
  return readJson(
    await fetch("/api/ad-lab/ads/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function syncAdLabAdsReport(targetId: string): Promise<AdLabPublication> {
  const data = await readJson<{ publication: AdLabPublication }>(
    await fetch("/api/ad-lab/ads/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    })
  );
  return data.publication;
}
