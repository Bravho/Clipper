import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";

/**
 * NextAuth route handler.
 * All auth API endpoints (/api/auth/*) are handled here.
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
