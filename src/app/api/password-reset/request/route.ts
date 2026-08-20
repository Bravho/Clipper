import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/appOrigin";
import { ROUTES } from "@/config/routes";
import {
  getPasswordResetService,
  ResetRequestOutcome,
} from "@/services/PasswordResetService";
import { forgotPasswordSchema } from "@/features/auth/validation/passwordResetSchema";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import type { ApiResponse } from "@/types";

/**
 * POST /api/password-reset/request
 * Body: { email: string }
 *
 * Answers TWO questions separately, because the UI reports both:
 *   emailFound   — is this address registered here?
 *   emailSent    — did the reset link actually leave the building?
 *
 * Always HTTP 200 for a well-formed body. "No such account" is a normal
 * answer to a normal question, not an error, and a 4xx would make the client
 * guess at the difference between that and a validation failure.
 */
interface RequestResetResult {
  outcome: ResetRequestOutcome;
  emailFound: boolean;
  emailSent: boolean;
  providers?: AuthProvider[];
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<ApiResponse<RequestResetResult>>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "รูปแบบคำขอไม่ถูกต้อง" },
      { status: 400 }
    );
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.errors[0]?.message ?? "อีเมลไม่ถูกต้อง",
      },
      { status: 400 }
    );
  }

  try {
    const service = await getPasswordResetService();
    const result = await service.requestReset(parsed.data.email, {
      // Built from the public origin, not `request.url` — behind nginx the
      // latter reads http://localhost:3000 and would mail out a dead link.
      resetUrl: (token) => {
        const url = appUrl(req, ROUTES.RESET_PASSWORD);
        url.searchParams.set("token", token);
        return url.toString();
      },
    });

    if (result.outcome === ResetRequestOutcome.EmailFailed) {
      console.error(
        "[Clipper] /api/password-reset/request delivery failed:",
        result.detail
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        outcome: result.outcome,
        emailFound: result.outcome !== ResetRequestOutcome.UnknownEmail,
        emailSent: result.outcome === ResetRequestOutcome.Sent,
        ...(result.providers ? { providers: result.providers } : {}),
      },
    });
  } catch (error) {
    console.error("[Clipper] /api/password-reset/request error:", error);
    return NextResponse.json(
      { success: false, error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" },
      { status: 500 }
    );
  }
}
