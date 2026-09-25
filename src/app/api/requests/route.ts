import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";
import {
  clipRequestFormSchema,
  studioClipRequestFormSchema,
} from "@/features/requests/validation/clipRequestSchema";
import { canAccessDeviceRenderLab } from "@/lib/mobile/deviceRenderLabAccess";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_COOKIE } from "@/i18n/config";

/**
 * POST /api/requests
 *
 * Creates a new draft clip request.
 * Supports both:
 *   - Draft save: body contains isDraft=true (partial validation)
 *   - Pre-submission create: body contains full form data
 *
 * Credits are NOT deducted here — deduction happens at /api/requests/[id]/submit.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Validate form data. The phone studio (which renders on the phone) may ask
  // for a longer video; everything else keeps the server's limits.
  const studio =
    (body as { studio?: unknown } | null)?.studio === true &&
    canAccessDeviceRenderLab(session.user.email);
  const parsed = (studio ? studioClipRequestFormSchema : clipRequestFormSchema).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const localeCookie = cookies().get(LOCALE_COOKIE)?.value;
    const contentLanguage = isAppLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;
    const draft = await clipRequestService.createDraft(
      session.user.id,
      parsed.data,
      contentLanguage
    );
    return NextResponse.json({ requestId: draft.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/requests]", err);
    return NextResponse.json(
      { error: "Failed to create request." },
      { status: 500 }
    );
  }
}
