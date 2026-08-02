import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/authOptions";
import { pushNotificationService } from "@/services/PushNotificationService";

const deviceSchema = z.object({
  // Native: FCM/APNs token. Web: the PushSubscription endpoint URL.
  token: z.string().trim().min(16).max(4096),
  platform: z.enum(["ios", "android", "web"]),
  // Web Push only — the subscription's encryption keys. Required for platform
  // "web", ignored otherwise.
  keys: z
    .object({
      p256dh: z.string().trim().min(1).max(512),
      auth: z.string().trim().min(1).max(512),
    })
    .optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  const parsed = deviceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid device registration." }, { status: 422 });
  }
  if (parsed.data.platform === "web" && !parsed.data.keys) {
    return NextResponse.json(
      { error: "Web Push registration requires subscription keys." },
      { status: 422 }
    );
  }
  await pushNotificationService.registerDevice(
    session.user.id,
    parsed.data.platform,
    parsed.data.token,
    parsed.data.keys
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  const parsed = deviceSchema.pick({ token: true }).safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid device token." }, { status: 422 });
  }
  await pushNotificationService.disableDevice(session.user.id, parsed.data.token);
  return NextResponse.json({ ok: true });
}

