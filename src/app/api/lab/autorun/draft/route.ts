import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";
import { studioClipRequestFormSchema } from "@/features/requests/validation/clipRequestSchema";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_COOKIE } from "@/i18n/config";
import { decideLabIdentity } from "@/lib/lab/labSteps";

/**
 * POST /api/lab/autorun/draft
 *
 * Lab auto-run only. Creates one draft for the lab test account. The gate is
 * checked here on the server: flag on, and the exact lab identity. The owner
 * is the session user, never a value from the body. Same validation as the
 * studio's own draft route. Off (404) unless LAB_AUTORUN_ENABLED is "true".
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const identity = decideLabIdentity({
    flagValue: process.env.LAB_AUTORUN_ENABLED,
    labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
    requesterRole: Role.Requester,
    session: session?.user
      ? {
          user: {
            id: session.user.id ?? null,
            role: session.user.role ?? null,
            email: session.user.email ?? null,
          },
        }
      : null,
  });
  if (!identity.ok) {
    return NextResponse.json(
      { error: identity.status === 404 ? "Not found." : "Unauthorised." },
      { status: identity.status }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // The owner is set from the session below; drop any owner-like field the body sent.
  const parsed = studioClipRequestFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const localeCookie = cookies().get(LOCALE_COOKIE)?.value;
    const contentLanguage = isAppLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;
    const draft = await clipRequestService.createDraft(identity.userId, parsed.data, contentLanguage);
    return NextResponse.json({ requestId: draft.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/lab/autorun/draft]", err);
    return NextResponse.json({ error: "Failed to create request." }, { status: 500 });
  }
}
