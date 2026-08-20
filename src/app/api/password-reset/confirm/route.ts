import { NextRequest, NextResponse } from "next/server";
import {
  getPasswordResetService,
  ResetTokenState,
} from "@/services/PasswordResetService";
import { resetPasswordSchema } from "@/features/auth/validation/passwordResetSchema";
import type { ApiResponse } from "@/types";

/**
 * POST /api/password-reset/confirm
 * Body: { token: string, password: string, confirmPassword: string }
 *
 * Writes the new password hash and burns the link. The user is NOT signed in
 * here — they go back to /login and sign in with the new password, which both
 * proves the reset worked and keeps this route free of session concerns.
 */
const TOKEN_ERRORS: Record<Exclude<ResetTokenState, ResetTokenState.Valid>, string> = {
  [ResetTokenState.Invalid]:
    "ลิงก์นี้ไม่ถูกต้อง กรุณาขอลิงก์ตั้งรหัสผ่านใหม่อีกครั้ง",
  [ResetTokenState.Expired]:
    "ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ตั้งรหัสผ่านใหม่อีกครั้ง",
  [ResetTokenState.Used]:
    "ลิงก์นี้ถูกใช้ไปแล้ว หากคุณยังเข้าสู่ระบบไม่ได้ กรุณาขอลิงก์ใหม่",
};

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  let body: { token?: unknown; password?: unknown; confirmPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "รูปแบบคำขอไม่ถูกต้อง" },
      { status: 400 }
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token) {
    return NextResponse.json(
      { success: false, error: TOKEN_ERRORS[ResetTokenState.Invalid] },
      { status: 400 }
    );
  }

  const parsed = resetPasswordSchema.safeParse({
    password: body.password,
    confirmPassword: body.confirmPassword,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    parsed.error.errors.forEach((err) => {
      const field = err.path[0]?.toString() ?? "password";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(err.message);
    });
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.errors[0]?.message ?? "รหัสผ่านไม่ผ่านเงื่อนไข",
        fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const service = await getPasswordResetService();
    const result = await service.confirmReset(token, parsed.data.password);

    if (result.state !== ResetTokenState.Valid) {
      return NextResponse.json(
        { success: false, error: TOKEN_ERRORS[result.state] },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Clipper] /api/password-reset/confirm error:", error);
    return NextResponse.json(
      { success: false, error: "ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 }
    );
  }
}
