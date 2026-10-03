import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDeviceRenderRequest,
  deviceRenderErrorResponse,
  readJsonBody,
} from "../../_guard";
import { deviceRenderService } from "@/services/DeviceRenderService";

/**
 * POST /api/device-render/[attemptId]/progress
 *
 * Heartbeat and percentage in one call. The response tells the device whether
 * it still holds the lease: `cancelled: true` means the work was reclaimed (a
 * lapsed lease, or a release from another surface) and the phone should stop
 * rendering rather than spend another two minutes of battery on an export the
 * server will refuse.
 */
const progressSchema = z.object({
  percent: z.number().min(0).max(100),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const { attemptId } = await params;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = progressSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid progress report." }, { status: 400 });
  }

  try {
    const result = await deviceRenderService.reportProgress(
      attemptId,
      auth.caller.userId,
      parsed.data.percent
    );
    return NextResponse.json(result);
  } catch (err) {
    return deviceRenderErrorResponse(err);
  }
}
