import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDeviceRenderRequest,
  deviceRenderErrorResponse,
  readJsonBody,
} from "../_guard";
import { deviceRenderService } from "@/services/DeviceRenderService";

/**
 * POST /api/device-render/claim
 *
 * The phone offers its capabilities; the server decides whether to lease it the
 * request's queued render step and, if so, returns the manifest to render.
 *
 * A refusal is a 200 with `claimed: false` and a reason, not an error: "the
 * worker is already on it" and "this phone is too full" are normal outcomes
 * that the editor shows as a state, and the job carries on either way.
 */
const claimSchema = z.object({
  requestId: z.string().min(1),
  appVersion: z.string().max(64).optional(),
  capabilities: z.object({
    platform: z.enum(["ios", "android"]),
    nativePluginVersion: z.number().int().nonnegative(),
    freeBytes: z.number().nonnegative(),
    supportsH264Encode: z.boolean(),
    supportsAacEncode: z.boolean(),
    appInForeground: z.boolean(),
    lowPowerMode: z.boolean(),
  }),
});

export async function POST(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = claimSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid claim request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await deviceRenderService.claim({
      requestId: parsed.data.requestId,
      userId: auth.caller.userId,
      capabilities: parsed.data.capabilities,
      appVersion: parsed.data.appVersion ?? null,
    });

    if ("claimed" in result) {
      return NextResponse.json({ claimed: false, reason: result.reason });
    }
    return NextResponse.json({ claimed: true, ...result });
  } catch (err) {
    return deviceRenderErrorResponse(err);
  }
}
