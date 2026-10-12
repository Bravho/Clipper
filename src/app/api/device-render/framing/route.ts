import { NextResponse } from "next/server";

import { authorizeDeviceRenderRequest, readJsonBody } from "../_guard";
import { clipRequestRepository } from "@/repositories/index";
import { createHash } from "node:crypto";

import {
  subjectFromThousandths,
  type ShotFocusBoxes,
  type SubjectBox,
} from "@/lib/mobile/shotFraming";

/**
 * POST /api/device-render/framing   { requestId }
 * POST /api/device-render/framing   { requestId, shots: [{ frames: [dataUrl, …] }, …] }
 *
 * With `shots` (the Channels step): where the subject is in each SHOT, from
 * small frames the phone takes inside the shot's own trimmed window, answered
 * as `{ boxes }` in the same order — see `lib/ai/shotFramingAi.ts`. The studio
 * frames every channel shape from these. Frames are looked at, never stored.
 *
 * Without `shots`:
 *
 * Where the main subject is in each of a request's photos and clips, so the
 * studio can frame every shot automatically: zoomed out just far enough that a
 * tall clip in a wide video still shows the whole product, and centred on it.
 *
 * It looks at the small pictures the server already holds — a photo's
 * derivative, a clip's poster frame — the same ones the storyboard was written
 * from, with the same AI consent. No original leaves the phone for this.
 *
 * Answers in the storyboard's asset-index order, `null` where nothing was
 * found. Fail-open: an AI error answers an empty list, and the studio simply
 * keeps its shape-only framing.
 */

// One answer per request per server process: a studio reopened, or a second
// tab, should not pay for the same look twice.
const cache = new Map<string, { at: number; subjects: (SubjectBox | null)[] }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const requestId = typeof parsed.body.requestId === "string" ? parsed.body.requestId : "";
  if (!requestId) return NextResponse.json({ error: "Missing requestId." }, { status: 400 });

  const clipRequest = await clipRequestRepository.findById(requestId);
  if (!clipRequest || clipRequest.userId !== auth.caller.userId) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (Array.isArray(parsed.body.shots)) {
    return answerShots(requestId, parsed.body.shots);
  }

  const cached = cache.get(requestId);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ subjects: cached.subjects });
  }

  const { getOrderedSourceAssets } = await import("@/lib/sourceAssets");
  const ordered = await getOrderedSourceAssets(requestId);
  if (ordered.length === 0) return NextResponse.json({ subjects: [] });

  try {
    const { detectProductCoordinates } = await import("@/lib/ai/geminiSubtitlesService");
    // A clip's `url` is its poster frame; a photo's is its derivative.
    const coords = await detectProductCoordinates(ordered.map((asset) => asset.url));
    const subjects = ordered.map((_, index) => subjectFromThousandths(coords?.[index]));
    cache.set(requestId, { at: Date.now(), subjects });
    return NextResponse.json({ subjects });
  } catch (err) {
    console.error("[device-render/framing] subject detection failed:", err);
    return NextResponse.json({ subjects: [] });
  }
}

// ─── Per-shot framing (Channels step) ────────────────────────────────────────

/** Bounds on what a phone may send: a storyboard is at most a few dozen shots. */
const MAX_SHOTS = 40;
const MAX_FRAMES_PER_SHOT = 3;
const MAX_FRAMES = 60;
/** A ~480px JPEG is 20–60 KB; anything far bigger is not a framing thumbnail. */
const MAX_FRAME_BASE64 = 300_000;

const shotCache = new Map<string, { at: number; boxes: (ShotFocusBoxes | null)[] }>();

function readFrame(value: unknown): { data: string; mimeType: string } | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[2].length > MAX_FRAME_BASE64) return null;
  return { mimeType: match[1], data: match[2] };
}

async function answerShots(requestId: string, rawShots: unknown[]) {
  if (rawShots.length === 0 || rawShots.length > MAX_SHOTS) {
    return NextResponse.json({ error: "Too many or no shots." }, { status: 400 });
  }
  const shots = rawShots.map((shot) => {
    const frames = Array.isArray((shot as { frames?: unknown })?.frames)
      ? ((shot as { frames: unknown[] }).frames)
      : [];
    return {
      frames: frames
        .slice(0, MAX_FRAMES_PER_SHOT)
        .map(readFrame)
        .filter((frame): frame is { data: string; mimeType: string } => frame !== null),
    };
  });
  const total = shots.reduce((sum, shot) => sum + shot.frames.length, 0);
  if (total === 0) return NextResponse.json({ boxes: shots.map(() => null) });
  if (total > MAX_FRAMES) {
    return NextResponse.json({ error: "Too many frames." }, { status: 400 });
  }

  // The same frames (a reopened Channels step) are answered once per process.
  const hash = createHash("sha1");
  hash.update(requestId);
  for (const shot of shots) {
    hash.update("|");
    for (const frame of shot.frames) hash.update(frame.data);
  }
  const key = hash.digest("hex");
  const cached = shotCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ boxes: cached.boxes });
  }

  try {
    const { detectShotFocusBoxes } = await import("@/lib/ai/shotFramingAi");
    const boxes = await detectShotFocusBoxes(shots);
    shotCache.set(key, { at: Date.now(), boxes });
    if (shotCache.size > 500) {
      const oldest = shotCache.keys().next().value;
      if (oldest) shotCache.delete(oldest);
    }
    return NextResponse.json({ boxes });
  } catch (err) {
    // Fail open: the studio keeps the framing it had.
    console.error("[device-render/framing] shot framing failed:", err);
    return NextResponse.json({ boxes: [] });
  }
}
