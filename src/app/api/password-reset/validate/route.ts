import { NextRequest, NextResponse } from "next/server";
import {
  getPasswordResetService,
  ResetTokenState,
} from "@/services/PasswordResetService";
import type { ApiResponse } from "@/types";

/**
 * GET /api/password-reset/validate?token=…
 *
 * Lets the reset page tell the user their link is dead BEFORE they choose and
 * type a password twice. Returns only the token's state and a masked address —
 * never the account's identity.
 */
interface ValidateResult {
  state: ResetTokenState;
  maskedEmail?: string;
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<ApiResponse<ValidateResult>>> {
  const token = req.nextUrl.searchParams.get("token") ?? "";

  if (!token) {
    return NextResponse.json({
      success: true,
      data: { state: ResetTokenState.Invalid },
    });
  }

  try {
    const service = await getPasswordResetService();
    const check = await service.checkToken(token);
    return NextResponse.json({
      success: true,
      data: {
        state: check.state,
        ...(check.maskedEmail ? { maskedEmail: check.maskedEmail } : {}),
      },
    });
  } catch (error) {
    console.error("[Clipper] /api/password-reset/validate error:", error);
    return NextResponse.json(
      { success: false, error: "ไม่สามารถตรวจสอบลิงก์ได้ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 }
    );
  }
}
