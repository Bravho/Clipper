/**
 * Shared guard for every /api/management route.
 *
 * Centralised so no route can forget a check. Each route still calls this
 * explicitly — there is no middleware magic — matching the existing convention
 * where API routes re-verify the session themselves rather than trusting
 * `src/middleware.ts` alone.
 *
 * Returns either a ready-made error response or the authenticated user.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { isManagementEnabledFor } from "@/config/management";

export interface ManagementUser {
  id: string;
  email: string | null;
  role: string;
}

export type GuardResult =
  | { ok: true; user: ManagementUser }
  | { ok: false; response: NextResponse };

export async function requireManagementUser(): Promise<GuardResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorised." }, { status: 401 }),
    };
  }
  if (session.user.role !== Role.Requester) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  const user: ManagementUser = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };

  // A disabled feature returns 404, not 403 — an off feature should be
  // indistinguishable from one that does not exist.
  if (!isManagementEnabledFor(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found." }, { status: 404 }),
    };
  }

  return { ok: true, user };
}

/**
 * Map a service error to the project's standard `{ error }` response.
 *
 * Provider and database details are never forwarded to the client; unknown
 * errors become a generic 500 and are logged server-side with their route tag.
 */
export function managementErrorResponse(routeTag: string, err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Unknown error.";

  if (message === "Access denied." || message.includes("another account")) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }
  if (message.includes("not found") || message.includes("not found.")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (message.startsWith("Unknown Channel Management product")) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }

  console.error(`[${routeTag}]`, err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
