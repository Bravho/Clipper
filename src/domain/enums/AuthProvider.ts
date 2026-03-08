/**
 * Authentication providers supported by Clipper.
 *
 * - Credentials: Email + password registration
 * - Google:      Google OAuth sign-in / sign-up
 *
 * Future providers (e.g. GitHub, LinkedIn) can be added here
 * and wired into the AuthIdentity model without breaking changes.
 */
export enum AuthProvider {
  Credentials = "credentials",
  Google = "google",
}
