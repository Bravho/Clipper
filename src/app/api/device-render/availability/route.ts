import { NextResponse } from "next/server";
import { authorizeDeviceRenderRequest, deviceRenderErrorResponse } from "../_guard";
import { deviceRenderService } from "@/services/DeviceRenderService";

/**
 * GET /api/device-render/availability?requestId=...
 *
 * Read-only: what a phone WOULD be asked to render for this request, without
 * taking a lease. The editor polls this so it can say "your phone can render
 * the captioned 9:16 now" or "this step runs on the server" instead of finding
 * out by claiming and immediately releasing — which would cost the requester
 * their place in the queue every time the screen was opened.
 */
export async function GET(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId is required." }, { status: 400 });
  }

  try {
    const availability = await deviceRenderService.describeAvailableWork(
      requestId,
      auth.caller.userId
    );
    return NextResponse.json(availability);
  } catch (err) {
    return deviceRenderErrorResponse(err);
  }
}
