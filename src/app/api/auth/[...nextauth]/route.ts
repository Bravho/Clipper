import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptionsForProvider } from "@/lib/auth/authOptions";

/**
 * NextAuth route handler.
 * All auth API endpoints (/api/auth/*) are handled here.
 *
 * Options are resolved per request rather than once at module load, because the
 * state/PKCE cookie policy differs by provider: Apple's form_post callback needs
 * SameSite=None, while Google must keep the SameSite=Lax default (Edge drops the
 * SameSite=None cookie, producing "State cookie was missing"). The route's
 * second path segment is the provider id — /api/auth/callback/google -> "google".
 */
interface RouteHandlerContext {
  params: { nextauth: string[] };
}

async function handler(req: NextRequest, ctx: RouteHandlerContext) {
  const providerId = ctx.params?.nextauth?.[1];
  return NextAuth(req, ctx, authOptionsForProvider(providerId));
}

export { handler as GET, handler as POST };
