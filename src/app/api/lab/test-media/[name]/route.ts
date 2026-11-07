import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { decideLabAccess, isSafeLabMediaName } from "@/lib/lab/labAccess";

/**
 * Lab auto-run only: serves one source video from a fixed folder on the
 * Mar-PC so the test phone can pull it over the USB tunnel.
 *
 * Off unless LAB_AUTORUN_ENABLED=true. Needs the runner's bearer token
 * (LAB_RUNNER_TOKEN). Read-only. The file name must be a plain name that is
 * already in the folder, so nothing outside it can be reached. Real users never
 * reach this code path.
 */

const LAB_MEDIA_DIR = process.env.LAB_MEDIA_DIR ?? "D:\\testing videos";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  // Flag first (off = 404), then the runner token, then the exact lab account.
  // Rules live in src/lib/lab/labAccess.ts and are unit-tested there.
  const needsSession =
    process.env.LAB_AUTORUN_ENABLED === "true" &&
    request.headers.get("authorization") === null;
  const session = needsSession ? await getServerSession(authOptions) : null;
  const decision = decideLabAccess({
    env: process.env,
    authorizationHeader: request.headers.get("authorization"),
    session,
    requesterRole: Role.Requester,
  });
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.status === 404 ? "Not found." : "Unauthorised." },
      { status: decision.status }
    );
  }

  const { name } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return NextResponse.json({ error: "Bad file name." }, { status: 400 });
  }
  if (!isSafeLabMediaName(decoded)) {
    return NextResponse.json({ error: "Bad file name." }, { status: 400 });
  }

  const fullPath = path.join(LAB_MEDIA_DIR, decoded);
  let size: number;
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = Readable.toWeb(createReadStream(fullPath)) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${decoded.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
