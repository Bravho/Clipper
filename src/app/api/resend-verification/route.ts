import { NextRequest, NextResponse } from "next/server";
import { emailVerificationService } from "@/services/EmailVerificationService";
import { EmailDeliveryError } from "@/lib/email";
import type { ApiResponse } from "@/types";

/**
 * POST /api/resend-verification
 * Body: { email: string }
 * Resends the verification email. Silent success if email is not registered.
 *
 * A delivery failure is reported as 502 with an explicit message rather than a
 * generic 500: the caller's button must stop spinning and say something true.
 * `sendEmail` is deadline-bounded, so this route always answers.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing email address." },
        { status: 400 }
      );
    }

    const result = await emailVerificationService.resend(email);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      console.error(
        `[Clipper] /api/resend-verification delivery failed via ${error.transport}:`,
        error.message
      );
      return NextResponse.json(
        {
          success: false,
          error:
            "ระบบส่งอีเมลไม่ทำงานอยู่ในขณะนี้ กรุณาลองใหม่ภายหลัง หรือติดต่อทีมงาน RClipper",
        },
        { status: 502 }
      );
    }

    console.error("[Clipper] /api/resend-verification error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to resend email. Please try again." },
      { status: 500 }
    );
  }
}
