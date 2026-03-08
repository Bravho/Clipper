import { NextRequest, NextResponse } from "next/server";
import { emailVerificationService } from "@/services/EmailVerificationService";
import type { ApiResponse } from "@/types";

/**
 * POST /api/verify-email
 * Body: { token: string }
 * Verifies the token and marks the user's email as verified.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const { token } = await req.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing verification token." },
        { status: 400 }
      );
    }

    const result = await emailVerificationService.verify(token);

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
