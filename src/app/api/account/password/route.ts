import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { accountService } from "@/services/AccountService";

/**
 * POST /api/account/password — change the password on a credentials account.
 * OAuth accounts (Google/Apple) have no password and receive 400.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  if (!currentPassword) {
    return NextResponse.json(
      { error: "กรุณากรอกรหัสผ่านปัจจุบัน" },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "รหัสผ่านใหม่ต้องแตกต่างจากรหัสผ่านเดิม" },
      { status: 400 }
    );
  }

  try {
    await accountService.changePassword(
      session.user.id,
      currentPassword,
      newPassword
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "InvalidCurrentPassword") {
      return NextResponse.json(
        { error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" },
        { status: 400 }
      );
    }
    if (message === "PasswordNotSupported") {
      return NextResponse.json(
        { error: "บัญชีนี้เข้าสู่ระบบผ่าน Google/Apple จึงไม่มีรหัสผ่าน" },
        { status: 400 }
      );
    }
    console.error("[POST /api/account/password]", err);
    return NextResponse.json(
      { error: "ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาลองอีกครั้ง" },
      { status: 500 }
    );
  }
}
