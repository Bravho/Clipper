import { NextResponse } from "next/server";
import { z } from "zod";
import { managementContentRepository } from "@/repositories";
import { requireManagementUser, managementErrorResponse } from "../../_guard";

export const dynamic = "force-dynamic";

/**
 * Per-video edit and soft-delete.
 *
 *   PATCH  — edit the title, description and the default caption/hashtags that
 *            pre-fill each channel at publish time.
 *   DELETE — SOFT delete: remove the video from the library and keep its record
 *            and publishing history; the stored file is left for its Space
 *            lifecycle rule to purge. Nothing is destroyed immediately.
 *
 * Both verify ownership first; a missing and a foreign item look identical (404),
 * so this cannot be used to probe other users' ids.
 */

const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullish(),
    defaultCaption: z.string().max(5000).nullish(),
    defaultHashtags: z.array(z.string().max(100)).max(60).optional(),
  })
  .strict();

async function ownedItem(id: string, userId: string) {
  const item = await managementContentRepository.findById(id);
  if (!item || item.userId !== userId) return null;
  return item;
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

  try {
    const item = await ownedItem(params.id, guard.user.id);
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const updated = await managementContentRepository.update(params.id, {
      // Only forward keys the client actually sent, so an omitted field is left
      // as-is while an explicit null/"" clears it.
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description ?? null }
        : {}),
      ...(parsed.data.defaultCaption !== undefined
        ? { defaultCaption: parsed.data.defaultCaption ?? null }
        : {}),
      ...(parsed.data.defaultHashtags !== undefined
        ? { defaultHashtags: parsed.data.defaultHashtags }
        : {}),
    });

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      defaultCaption: updated.defaultCaption,
      defaultHashtags: updated.defaultHashtags,
    });
  } catch (err) {
    return managementErrorResponse("PATCH /api/management/content/[id]", err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  try {
    const item = await ownedItem(params.id, guard.user.id);
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });

    await managementContentRepository.softRemove(params.id);
    return NextResponse.json({ ok: true, removed: true });
  } catch (err) {
    return managementErrorResponse("DELETE /api/management/content/[id]", err);
  }
}
