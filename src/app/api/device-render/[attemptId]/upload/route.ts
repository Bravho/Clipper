import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDeviceRenderRequest,
  deviceRenderErrorResponse,
  readJsonBody,
} from "../../_guard";
import { deviceRenderService } from "@/services/DeviceRenderService";

/**
 * POST /api/device-render/[attemptId]/upload
 *
 * Two actions on the rendered output's transfer:
 *
 *   authorize → presigned part URLs for the key this attempt was given, plus a
 *               single PUT URL for its cover still
 *   finish    → assemble the uploaded parts into the final object
 *
 * The part count depends on the size of a file that does not exist at claim
 * time, which is why the manifest's `upload` is null until the render is done.
 * The key itself is never negotiable: it was minted when the attempt was
 * created, so a device can only ever write where the server put it.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("authorize"),
    fileSizeBytes: z.number().int().positive(),
    coverBytes: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    action: z.literal("finish"),
    parts: z
      .array(z.object({ partNumber: z.number().int().positive(), eTag: z.string().min(1) }))
      .min(1)
      .max(10_000),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const { attemptId } = await params;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.action === "authorize") {
      const upload = await deviceRenderService.authorizeUpload(
        attemptId,
        auth.caller.userId,
        parsed.data.fileSizeBytes,
        parsed.data.coverBytes ?? null
      );
      return NextResponse.json(upload);
    }

    const result = await deviceRenderService.finishUpload(
      attemptId,
      auth.caller.userId,
      parsed.data.parts
    );
    return NextResponse.json(result);
  } catch (err) {
    return deviceRenderErrorResponse(err);
  }
}
