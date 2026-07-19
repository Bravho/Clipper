import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { accountService } from "@/services/AccountService";

/**
 * DELETE /api/account — delete the signed-in user's account.
 *
 * App Store 5.1.1(v) / Play Store User Data policy compliant:
 * - initiated in-app (and via this same web page, satisfying Play's web link)
 * - PII erased, login identities removed
 * - financial/consent records retained (legal requirement)
 * - hashed fraud-prevention registry entry written (disclosed retention)
 *
 * Credentials accounts must re-verify with their password (permitted by
 * Apple to confirm the deletion is intentional). The client signs the user
 * out after a successful response.
 */
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  // Staff/Admin accounts are internal (seed/admin-created) — not self-deletable.
  if (session.user.role !== Role.Requester) {
    return NextResponse.json(
      { error: "บัญชีทีมงานไม่สามารถลบด้วยตนเองได้ กรุณาติดต่อผู้ดูแลระบบ" },
      { status: 403 }
    );
  }

  let body: { password?: string; confirm?: string } = {};
  try {
    body = await request.json();
  } catch {
    // body optional for OAuth accounts (typed confirmation checked below)
  }

  // OAuth accounts have no password — require the typed confirmation instead.
  if (session.user.provider !== AuthProvider.Credentials) {
    if (body.confirm !== "DELETE") {
      return NextResponse.json(
        { error: 'กรุณาพิมพ์ "DELETE" เพื่อยืนยันการลบบัญชี' },
        { status: 400 }
      );
    }
  }

  try {
    await accountService.deleteAccount(session.user.id, {
      password: body.password,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "InvalidCurrentPassword") {
      return NextResponse.json(
        { error: "รหัสผ่านไม่ถูกต้อง" },
        { status: 400 }
      );
    }
    if (message === "UserNotFound") {
      return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    }
    console.error("[DELETE /api/account]", err);
    return NextResponse.json(
      { error: "ไม่สามารถลบบัญชีได้ กรุณาลองอีกครั้ง" },
      { status: 500 }
    );
  }
}
