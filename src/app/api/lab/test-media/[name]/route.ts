import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";

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
const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  if (process.env.LAB_AUTORUN_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Either the runner's bearer token (Mar-PC runner), or the signed-in LAB test
  // account itself (the test phone). Never a real user's session.
  const expected = process.env.LAB_RUNNER_TOKEN ?? "";
  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const tokenOk = Boolean(expected) && tokenMatches(presented, expected);

  let labSessionOk = false;
  if (!tokenOk) {
    const labEmail = (process.env.DEVICE_RENDER_LAB_TEST_EMAIL ?? "").trim().toLowerCase();
    const session = await getServerSession(authOptions);
    labSessionOk =
      Boolean(labEmail) &&
      session?.user?.role === Role.Requester &&
      (session.user.email ?? "").trim().toLowerCase() === labEmail;
  }
  if (!tokenOk && !labSessionOk) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const { name } = await params;
  const decoded = decodeURIComponent(name);
  // Plain file name only: no separators, no parent references.
  if (
    decoded !== path.basename(decoded) ||
    decoded.includes("..") ||
    !ALLOWED_EXTENSIONS.has(path.extname(decoded).toLowerCase())
  ) {
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
