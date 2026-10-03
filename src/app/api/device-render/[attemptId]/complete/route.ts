import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDeviceRenderRequest,
  deviceRenderErrorResponse,
  readJsonBody,
} from "../../_guard";
import { deviceRenderService } from "@/services/DeviceRenderService";

/**
 * POST /api/device-render/[attemptId]/complete
 *
 * The device says it is done. The server checks every field against the attempt
 * it handed out, inspects the object that actually landed in storage, creates
 * the asset, hands the result to the pipeline and closes the claim.
 *
 * SAFE TO RETRY. A phone that loses the network after uploading will call this
 * again; the second call returns the first result rather than creating a second
 * export. That guarantee lives in the repository's `completeOnce`, not here.
 */
const completeSchema = z.object({
  jobId: z.string().min(1),
  step: z.string().min(1),
  stage: z.enum(["montage", "master", "final"]),
  ratio: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  manifestVersion: z.number().int().positive(),
  storageKey: z.string().min(1),
  coverStorageKey: z.string().min(1).nullable().optional(),
  fileSizeBytes: z.number().int().positive(),
  durationSeconds: z.number().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  hasAudioTrack: z.boolean(),
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

  const parsed = completeSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid completion.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await deviceRenderService.complete({
      attemptId,
      userId: auth.caller.userId,
      ...parsed.data,
      coverStorageKey: parsed.data.coverStorageKey ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return deviceRenderErrorResponse(err);
  }
}
