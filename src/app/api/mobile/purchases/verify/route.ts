import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { mobileStorePurchaseService } from "@/services/MobileStorePurchaseService";

const purchaseSchema = z.object({
  platform: z.enum(["ios", "android"]),
  productId: z.string().trim().min(3).max(200),
  transactionId: z.string().trim().min(3).max(4096),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const parsed = purchaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid store purchase." }, { status: 422 });
  }
  try {
    const result = await mobileStorePurchaseService.verifyAndGrant({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[mobile purchase] verification failed:", err);
    return NextResponse.json(
      { error: "The store purchase could not be verified." },
      { status: 422 }
    );
  }
}

