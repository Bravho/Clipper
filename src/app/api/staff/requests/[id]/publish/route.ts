import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { publishingService } from "@/services/staff/PublishingService";
import {
  markPublishedSchema,
  addPublishingLinkSchema,
} from "@/features/staff/validation/staffActionSchemas";

/**
 * POST /api/staff/requests/[id]/publish
 * Mark a request as Published.
 * Requires at least one publishing link to exist.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = markPublishedSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    await publishingService.markPublished(params.id, parsed.data.note);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * PUT /api/staff/requests/[id]/publish
 * Add a publishing link to a request.
 * Body: { platform: Platform, url: string }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = addPublishingLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const link = await publishingService.addPublishingLink(
      params.id,
      parsed.data.platform,
      parsed.data.url
    );
    return NextResponse.json({ link });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
