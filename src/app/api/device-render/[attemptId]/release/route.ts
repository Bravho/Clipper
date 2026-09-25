import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDeviceRenderRequest,
  deviceRenderErrorResponse,
  readJsonBody,
} from "../../_guard";
import { deviceRenderService } from "@/services/DeviceRenderService";

/**
 * POST /api/device-render/[attemptId]/release
 *
 * Give the work back to the queue: the user cancelled, storage ran out, the
 * render threw, or the app is about to be killed. The render task keeps its
 * FIFO position and priority, so the Mac Mini worker takes it next.
 *
 * This is the fallback path made explicit. A phone that cannot finish should
 * say so in one call rather than leaving the requester to wait out a whole
 * lease while nothing renders.
 */
const releaseSchema = z.object({
  reason: z.string().min(1).max(200).default("cancelled"),
  /** The phone's step-by-step log of the failed attempt (see RenderErrorLog). */
  log: z.array(z.string().max(600)).max(120).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const { attemptId } = await params;
  const json = await readJsonBody(request);
  // A release must succeed even from a client that is being torn down and sent
  // an empty body, so a malformed body falls back to the default reason rather
  // than refusing to let go of the lease.
  const parsed = releaseSchema.safeParse(json.ok ? json.body : {});
  const reason = parsed.success ? parsed.data.reason : "cancelled";
  const log = parsed.success ? parsed.data.log : undefined;

  try {
    const result = await deviceRenderService.release(attemptId, auth.caller.userId, reason, log);
    return NextResponse.json(result);
  } catch (err) {
    return deviceRenderErrorResponse(err);
  }
}
