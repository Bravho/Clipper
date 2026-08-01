import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementPublicationService,
  PublicationActionError,
} from "@/services/management/ManagementPublicationService";
import { requireManagementUser, managementErrorResponse } from "../../_guard";

export const dynamic = "force-dynamic";

/**
 * Edit or cancel ONE destination ("post") of a publication.
 *
 *   PATCH  — edit the caption / title / hashtags of a still-SCHEDULED post and
 *            push the change to the provider.
 *   DELETE — cancel a still-SCHEDULED post at the provider before it fires.
 *
 * Both are refused for a post that is already publishing or live: Post for Me
 * (and the platforms) only permit update/delete while a post is draft or
 * scheduled, so the manage-posts UI never offers these on a published post. The
 * target id is carried in the query string; ownership is checked in the service,
 * where a missing and a foreign publication look identical.
 */

const patchSchema = z
  .object({
    targetId: z.string().uuid(),
    caption: z.string().max(5000).optional(),
    title: z.string().max(300).nullish(),
    description: z.string().max(5000).nullish(),
    hashtags: z.array(z.string().max(100)).max(60).optional(),
  })
  .strict();

function actionStatus(code: PublicationActionError["code"]): number {
  switch (code) {
    case "not_found":
      return 404;
    case "not_editable":
      return 409;
    case "provider_error":
    default:
      return 502;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { targetId, ...copy } = parsed.data;

  try {
    const updated = await managementPublicationService.editScheduledTarget(
      guard.user,
      params.id,
      targetId,
      {
        ...(copy.caption !== undefined ? { caption: copy.caption } : {}),
        ...(copy.title !== undefined ? { title: copy.title ?? null } : {}),
        ...(copy.description !== undefined
          ? { description: copy.description ?? null }
          : {}),
        ...(copy.hashtags !== undefined ? { hashtags: copy.hashtags } : {}),
      }
    );
    return NextResponse.json({
      target: {
        id: updated.id,
        platform: updated.platform,
        caption: updated.caption,
        title: updated.title,
        description: updated.description,
        hashtags: updated.hashtags,
        status: updated.status,
      },
    });
  } catch (err) {
    if (err instanceof PublicationActionError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: actionStatus(err.code) }
      );
    }
    return managementErrorResponse("PATCH /api/management/publications/[id]", err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  const targetId = new URL(request.url).searchParams.get("targetId") ?? "";
  if (!targetId) {
    return NextResponse.json({ error: "A targetId is required." }, { status: 400 });
  }

  try {
    await managementPublicationService.cancelScheduledTarget(
      guard.user,
      params.id,
      targetId
    );
    return NextResponse.json({ ok: true, cancelled: true });
  } catch (err) {
    if (err instanceof PublicationActionError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: actionStatus(err.code) }
      );
    }
    return managementErrorResponse("DELETE /api/management/publications/[id]", err);
  }
}
