import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { authService } from "@/services/AuthService";
import { ROUTES, getRoleHomePath } from "@/config/routes";
import { logAuthEvent } from "@/lib/auth/diagnostics";

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
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),

    // ---- Apple OAuth (Sign in with Apple) -----------------------------------
    // Required by App Store guideline 4.8 when a third-party login (Google)
    // is offered. APPLE_CLIENT_SECRET is a self-signed ES256 JWT that expires
    // after at most 6 months — regenerate it before expiry.
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID ?? "",
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? "",
    }),

    // ---- Credentials (email + password) -------------------------------------
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          logAuthEvent("credentials_rejected", { reason: "missing_fields" });
          return null;
        }

        let verifiedUser: Awaited<
          ReturnType<typeof authService.verifyCredentials>
        >;
        try {
          verifiedUser = await authService.verifyCredentials(
            credentials.email,
            credentials.password
          );
        } catch (error) {
          logAuthEvent("credentials_rejected", {
            reason:
              error instanceof Error ? error.message : "verification_error",
          });
          throw error;
        }

        if (!verifiedUser) {
          logAuthEvent("credentials_rejected", {
            reason: "invalid_credentials",
          });
          return null;
        }

        logAuthEvent("credentials_accepted", {
          userId: verifiedUser.id,
          role: verifiedUser.role,
        });

        // Return the shape that NextAuth expects (with our custom fields)
        return {
          id: verifiedUser.id,
          email: verifiedUser.email,
          name: verifiedUser.name,
          role: verifiedUser.role,
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
      if (account?.provider === "google" || account?.provider === "apple") {
        const provider =
          account.provider === "google"
            ? AuthProvider.Google
            : AuthProvider.Apple;
        try {
          // Note: Apple only sends the user's name on the FIRST authorization;
          // fall back to the email if absent.
          const oauthUser = await authService.findOrCreateOAuthUser(provider, {
            providerAccountId: account.providerAccountId!,
            email: user.email!,
            name: user.name ?? user.email!,
          });

          // Mutate the user object so the jwt callback receives correct data
          user.id = oauthUser.id;
          user.role = oauthUser.role;
          user.provider = provider;

          return true;
        } catch (error) {
          console.error(`[Clipper] ${account.provider} signIn error:`, error);
          return false;
        }
      }

      // Credentials provider: authorize() already validated the user
      logAuthEvent("signin_callback_accepted", {
        userId: user.id,
        provider: account?.provider ?? "credentials",
      });
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
        logAuthEvent("jwt_created", {
          userId: user.id,
          role: user.role as Role,
          provider: user.provider as AuthProvider,
        });
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
        logAuthEvent("session_returned", {
          userId: token.id as string,
          role: token.role as Role,
          provider: token.provider as AuthProvider,
        });
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

  // NOTE: no `cookies` override here — the NextAuth defaults (SameSite=Lax) are
  // correct for Google and credentials sign-in. See authOptionsForProvider()
  // below for the Apple-only exception.

  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * Providers whose OAuth callback arrives as a cross-site POST
 * (`response_mode=form_post`). Only Apple does this — the browser will not
 * attach a SameSite=Lax cookie to a cross-site POST, so the state/PKCE cookies
 * must be SameSite=None; Secure for those providers.
 */
const CROSS_SITE_CALLBACK_PROVIDERS = new Set(["apple"]);

/**
 * Per-request auth options for the /api/auth/[...nextauth] route handler.
 *
 * NextAuth's `cookies` config is global, but the SameSite=None relaxation is
 * only safe (and only needed) for Apple. Applying it to Google broke sign-in in
 * Edge — Edge's tracking prevention drops the SameSite=None state cookie, and
 * the callback then fails with `OAuthCallbackError: State cookie was missing.`
 * Google's callback is an ordinary top-level GET redirect, which SameSite=Lax
 * cookies are sent on, so Google must keep the defaults.
 *
 * @param providerId the provider segment of the route (e.g. "google", "apple")
 */
export function authOptionsForProvider(
  providerId?: string
): NextAuthOptions {
  const isHttps = process.env.NEXTAUTH_URL?.startsWith("https") ?? false;

  // SameSite=None requires Secure, which would break local http development.
  if (!isHttps || !providerId || !CROSS_SITE_CALLBACK_PROVIDERS.has(providerId)) {
    return authOptions;
  }

  const crossSiteCookie = {
    httpOnly: true,
    sameSite: "none" as const,
    path: "/",
    secure: true,
    maxAge: 60 * 15, // matches the NextAuth default
  };

  return {
    ...authOptions,
    cookies: {
      pkceCodeVerifier: {
        name: "__Secure-next-auth.pkce.code_verifier",
        options: crossSiteCookie,
      },
      state: {
        name: "__Secure-next-auth.state",
        options: crossSiteCookie,
      },
    },
  };
}
