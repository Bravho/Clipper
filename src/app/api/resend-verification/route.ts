import { NextRequest, NextResponse } from "next/server";
import { emailVerificationService } from "@/services/EmailVerificationService";
import type { ApiResponse } from "@/types";

/**
 * POST /api/resend-verification
 * Body: { email: string }
 * Resends the verification email. Silent success if email is not registered.
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
    console.error("[Clipper] /api/resend-verification error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to resend email. Please try again." },
      { status: 500 }
    );
  }
}
