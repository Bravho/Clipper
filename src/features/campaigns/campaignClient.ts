"use client";

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { DeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";
import type {
  CreatorCampaignStatus,
  PublicCampaignView,
  RewardClaimResult,
} from "@/services/campaigns/CampaignCreatorService";

/**
 * The customer side of a Merchant Campaign, in the app (no login).
 *
 * The only identity is a random UUID this installation makes once and keeps in
 * app-private storage (Preferences: SharedPreferences / UserDefaults, private
 * to the app). It is NOT a device identifier — no IMEI, serial, MAC or
 * advertising id — and reinstalling the app makes a new one. The server only
 * ever stores a peppered hash of it.
 */

const INSTALL_ID_KEY = "rclipper.campaign.installId";
let cachedInstallId: string | null = null;

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readStored(): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      return (await Preferences.get({ key: INSTALL_ID_KEY })).value;
    }
    return window.localStorage.getItem(INSTALL_ID_KEY);
  } catch {
    return null;
  }
}

async function writeStored(value: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: INSTALL_ID_KEY, value });
    } else {
      window.localStorage.setItem(INSTALL_ID_KEY, value);
    }
  } catch {
    // A private window: the id lives for this page only. Still works.
  }
}

export async function getInstallId(): Promise<string> {
  if (cachedInstallId) return cachedInstallId;
  const stored = await readStored();
  if (stored && /^[0-9a-f-]{36}$/i.test(stored)) {
    cachedInstallId = stored;
    return stored;
  }
  const created = newUuid();
  await writeStored(created);
  cachedInstallId = created;
  return created;
}

/** A refusal from the campaign API, with its machine-readable code. */
export class CampaignApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "CampaignApiError";
  }
}

async function call<T>(
  slug: string,
  path: string,
  init: { method: "GET" | "POST"; qrKey: string; body?: Record<string, unknown> }
): Promise<T> {
  const installId = await getInstallId();
  const base = `/api/campaigns/${encodeURIComponent(slug)}${path}`;
  const url = init.method === "GET" ? `${base}?k=${encodeURIComponent(init.qrKey)}` : base;
  const response = await fetch(url, {
    method: init.method,
    cache: "no-store",
    headers: {
      "X-Install-Id": installId,
      ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: init.method === "POST" ? JSON.stringify({ ...(init.body ?? {}), k: init.qrKey }) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new CampaignApiError(
      typeof json.error === "string" ? json.error : `HTTP ${response.status}`,
      typeof json.code === "string" ? json.code : "server_error",
      response.status
    );
  }
  return json as T;
}

export function startCampaignSession(slug: string, qrKey: string) {
  return call<{ campaign: PublicCampaignView; status: CreatorCampaignStatus }>(slug, "/session", {
    method: "POST",
    qrKey,
  });
}

export function fetchCampaignStatus(slug: string, qrKey: string) {
  return call<{ status: CreatorCampaignStatus }>(slug, "/status", { method: "GET", qrKey });
}

export interface CampaignManifestResponse {
  manifest: DeviceRenderManifest;
  useClipSound: boolean;
  musicTrackId: string;
  pictureSeconds: number;
}

export function fetchCampaignManifest(
  slug: string,
  qrKey: string,
  body: { localId: string; mimeType: string; durationSeconds: number; statement: string; sound: string }
) {
  return call<CampaignManifestResponse>(slug, "/manifest", { method: "POST", qrKey, body });
}

export function reportVideoMade(slug: string, qrKey: string) {
  return call<{ videosMade: number }>(slug, "/video-made", { method: "POST", qrKey });
}

export function claimCampaignReward(slug: string, qrKey: string) {
  return call<RewardClaimResult>(slug, "/reward-claim", { method: "POST", qrKey });
}

export function addCampaignPost(slug: string, qrKey: string, url: string) {
  return call<{ platform: string; url: string }>(slug, "/social-post", {
    method: "POST",
    qrKey,
    body: { url },
  });
}

/**
 * Is this text an RClipper campaign link? Returns the in-app path to open
 * (`/c/<slug>?k=<key>`), or null. Accepts the production host, the configured
 * app origin, and (in development) any host, so a dev QR can be tested.
 */
export function campaignPathFromQr(text: string, currentOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "app.rclipper.com" ||
    host === new URL(currentOrigin).hostname.toLowerCase() ||
    process.env.NODE_ENV === "development";
  if (!allowed) return null;
  const match = url.pathname.match(/^\/c\/([a-z0-9]{6,16})\/?$/);
  const key = url.searchParams.get("k");
  if (!match || !key) return null;
  return `/c/${match[1]}?k=${encodeURIComponent(key)}`;
}
