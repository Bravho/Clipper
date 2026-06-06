import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { businessProfileService } from "@/services/BusinessProfileService";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  try {
    const profile = await businessProfileService.getProfile(session.user.id);
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("[GET /api/account/profile]", err);
    return NextResponse.json(
      { error: "Failed to fetch profile." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { businessName, category, location, description, menuDetails } = body;

  if (!businessName || !category) {
    return NextResponse.json(
      { error: "Business name and category are required." },
      { status: 400 }
    );
  }

  try {
    const profile = await businessProfileService.saveProfile(session.user.id, {
      businessName,
      category,
      location: location ?? null,
      description: description ?? null,
      menuDetails: menuDetails ?? null,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("[POST /api/account/profile]", err);
    return NextResponse.json(
      { error: "Failed to save profile." },
      { status: 500 }
    );
  }
}
