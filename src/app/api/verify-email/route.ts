import { NextRequest, NextResponse } from "next/server";
import { emailVerificationService } from "@/services/EmailVerificationService";
import type { ApiResponse } from "@/types";

/**
 * POST /api/verify-email
 * Body: { email: string, code: string }
 * Verifies the token and marks the user's email as verified.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const { email, code } = await req.json();

    if (
      typeof email !== "string" ||
      !email ||
      typeof code !== "string" ||
      !/^\d{6}$/.test(code)
    ) {
      return NextResponse.json(
        { success: false, error: "Enter the six-digit verification code." },
        { status: 400 }
      );
    }

    const result = await emailVerificationService.verify(email, code);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Clipper] /api/verify-email error:", error);
    return NextResponse.json(
      { success: false, error: "Verification failed. Please try again." },
      { status: 500 }
    );
  }
}
