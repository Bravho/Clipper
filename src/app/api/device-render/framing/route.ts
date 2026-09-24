import { NextResponse } from "next/server";

import { authorizeDeviceRenderRequest, readJsonBody } from "../_guard";
import { clipRequestRepository } from "@/repositories/index";
import { subjectFromThousandths, type SubjectBox } from "@/lib/mobile/shotFraming";

/**
 * POST /api/device-render/framing   { requestId }
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
