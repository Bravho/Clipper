// DEPRECATED: Use POST /api/requests/[id]/voice/regenerate instead.
import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    { error: "Deprecated. Use POST /api/requests/[id]/voice/regenerate instead." },
    { status: 410 }
  );
}
