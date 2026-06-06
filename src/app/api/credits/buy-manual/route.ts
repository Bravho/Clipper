import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { creditService } from "@/services/CreditService";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { creditsAmount, pricePaidBaht, reference } = body;

  const parsedCredits = parseInt(creditsAmount, 10);
  const parsedPrice = parseFloat(pricePaidBaht);

  if (isNaN(parsedCredits) || parsedCredits <= 0) {
    return NextResponse.json(
      { error: "จำนวนเครดิตต้องเป็นตัวเลขที่มากกว่า 0" },
      { status: 400 }
    );
  }

  if (isNaN(parsedPrice) || parsedPrice < 0) {
    return NextResponse.json(
      { error: "ราคาที่จ่ายต้องเป็นตัวเลขที่ไม่ติดลบ" },
      { status: 400 }
    );
  }

  if (!reference || typeof reference !== "string" || reference.trim() === "") {
    return NextResponse.json(
      { error: "กรุณาระบุเลขอ้างอิงการโอนเงิน (เช่น เลขที่สลิป หรือรายละเอียดการโอน)" },
      { status: 400 }
    );
  }

  try {
    const updatedWallet = await creditService.buyCreditsManual(
      session.user.id,
      parsedCredits,
      parsedPrice,
      reference.trim()
    );

    return NextResponse.json({
      success: true,
      balance: updatedWallet.balance,
    });
  } catch (err) {
    console.error("[POST /api/credits/buy-manual]", err);
    return NextResponse.json(
      { error: "เกิดข้อผิดพลาดในการบันทึกรายการซื้อเครดิต" },
      { status: 500 }
    );
  }
}
