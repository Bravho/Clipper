import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { authService } from "@/services/AuthService";
import { ROUTES, getRoleHomePath } from "@/config/routes";

/**
 * NextAuth configuration for Clipper.
 *
 * Providers:
 *   1. Credentials — email + password (verified by AuthService)
 *   2. Google     — OAuth sign-in / sign-up (handled by AuthService)
 *
 * Session strategy: JWT (no database session table required in this phase).
 *
 * TODO: PostgreSQL — when adding a session table, change strategy to "database"
 *       and configure the NextAuth adapter (e.g. DrizzleAdapter, PrismaAdapter).
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  providers: [
    // ---- Google OAuth --------------------------------------------------------
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),

    // ---- Credentials (email + password) -------------------------------------
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await authService.verifyCredentials(
          credentials.email,
          credentials.password
        );

        if (!user) return null;

        // Return the shape that NextAuth expects (with our custom fields)
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          provider: AuthProvider.Credentials,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * signIn callback — runs on every sign-in attempt.
     * Used to handle Google OAuth account creation/linking.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        try {
          const googleUser = await authService.findOrCreateGoogleUser({
            googleAccountId: account.providerAccountId!,
            email: user.email!,
            name: user.name ?? user.email!,
          });

          // Mutate the user object so the jwt callback receives correct data
          user.id = googleUser.id;
          user.role = googleUser.role;
          user.provider = AuthProvider.Google;

          return true;
        } catch (error) {
          console.error("[Clipper] Google signIn error:", error);
          return false;
        }
      }

      // Credentials provider: authorize() already validated the user
      return true;
    },

    /**
     * jwt callback — runs when JWT is created or updated.
     * Add Clipper custom fields to the token here.
     */
    async jwt({ token, user }) {
      if (user) {
        // First sign-in: user object is available
        token.id = user.id;
        token.role = user.role as Role;
        token.provider = user.provider as AuthProvider;
      }
      return token;
    },

    /**
     * session callback — shapes the session object available to the app.
     * Transfers JWT claims to session.user.
     */
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.provider = token.provider;
      }
      return session;
    },

    /**
     * redirect callback — redirects user to role-appropriate page after login.
     */
    async redirect({ url, baseUrl }) {
      // If a callbackUrl is explicitly set (e.g. from protected page redirect), use it
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return baseUrl;
    },
  },

  pages: {
    signIn: ROUTES.LOGIN,
    error: ROUTES.LOGIN,
  },

  secret: process.env.NEXTAUTH_SECRET,
};
