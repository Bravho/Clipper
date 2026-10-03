import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { authorizeDeviceRenderRequest, readJsonBody } from "../_guard";
import { PIPELINE_STEP_COSTS } from "@/config/credits";
import { Platform } from "@/domain/enums/Platform";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_COOKIE } from "@/i18n/config";
import { generateSpeakingScript } from "@/lib/ai/chatGptVisionService";
import {
  MAX_LOCAL_ANALYSIS_BYTES,
  localAnalysisFrameSchema,
  totalAnalysisBytes,
} from "@/lib/mobile/localMediaContract";

/**
 * POST /api/device-render/storyboard
 *
 * Plans a storyboard for material that is still on the requester's phone.
 *
 * WHAT THIS ROUTE IS ALLOWED TO SEE. Small poster frames the editor already
 * generated for its own thumbnails, and the words the requester typed. Not the
 * originals — the whole point of the on-device editor is that a photo or a clip
 * never leaves the phone, and a storyboard is not a good enough reason to break
 * that. The frames are held in memory for the length of one Gemini call and
 * written nowhere, which is the same contract `localMediaSubmission` makes for
 * its analysis frames.
 *
 * WHY IT IS NOT A JOB. Nothing here creates a `VideoGenerationJob`, touches a
 * pipeline step, spends a credit or approves anything. A storyboard from this
 * route is a suggestion the person rearranges on the phone; the real pipeline's
 * Stage-1 storyboard still comes from `generateSpeakingScript` inside
 * `VideoGenerationService`, against uploaded assets, behind the usual gates.
 * Two callers, one planner, no second implementation to keep in step.
 *
 * It sits behind the device-render guard, so the tester cohort
 * (`DEVICE_RENDER_LAB_TEST_EMAIL`) is the only cohort that can reach it, and an
 * account outside it gets a 404 rather than a hint that the endpoint exists.
 */

const PLATFORM_VALUES = Object.values(Platform) as [Platform, ...Platform[]];

const bodySchema = z.object({
  brief: z.object({
    clipName: z.string().trim().max(200).default(""),
    placeName: z.string().trim().min(1).max(200),
    details: z.string().trim().min(1).max(4000),
    targetSeconds: z.coerce
      .number()
      .int()
      .min(PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS)
      .max(PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS),
    platforms: z.array(z.enum(PLATFORM_VALUES)).min(1).max(PLATFORM_VALUES.length),
  }),
  materials: z
    .array(
      z.object({
        localId: z.string().min(1).max(160),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(120),
        kind: z.enum(["image", "clip"]),
        durationSeconds: z.number().positive().nullable(),
      })
    )
    .min(1)
    .max(40),
  frames: z.array(localAnalysisFrameSchema).min(1).max(30),
});

export async function POST(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That storyboard request was not usable.", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { brief, materials, frames } = parsed.data;

  // The frame count is capped by the schema; the byte total is not, and a
  // caller that bypassed the editor could send thirty full-resolution stills.
  if (totalAnalysisBytes(frames) > MAX_LOCAL_ANALYSIS_BYTES) {
    return NextResponse.json(
      { error: "Those preview frames are too large to plan from." },
      { status: 413 }
    );
  }

  // Every frame must point at material that was actually declared, or the
  // indexes the model is told to use do not mean what they say.
  for (const frame of frames) {
    if (materials[frame.assetIndex]?.localId !== frame.localId) {
      return NextResponse.json(
        { error: "A preview frame does not match the material it claims to come from." },
        { status: 422 }
      );
    }
  }

  const localeCookie = cookies().get(LOCALE_COOKIE)?.value;
  const contentLanguage = isAppLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;

  try {
    const output = await generateSpeakingScript({
      // Position is the asset index, and with `inlineFrames` present the URLs
      // themselves are never read — only counted. Nothing is fetched from
      // storage, because nothing of this requester's is in storage.
      imageUrls: materials.map(() => ""),
      inlineFrames: frames,
      placeName: brief.placeName,
      title: brief.clipName,
      description: brief.details,
      targetAudience: "",
      targetPlatforms: brief.platforms,
      preferredStyle: "",
      videoDurationSeconds: brief.targetSeconds,
      contentLanguage,
    });

    return NextResponse.json({
      // `generateSpeakingScript` sanitizes the storyboard against the asset
      // count before returning it, so every index here addresses real material.
      scenes: output.storyboard,
      script: output.scriptThai,
      caption: output.captionThai,
      theme: output.theme,
    });
  } catch (err) {
    console.error("[POST /api/device-render/storyboard]", err);
    return NextResponse.json(
      { error: "The storyboard could not be planned just now." },
      { status: 502 }
    );
  }
}
