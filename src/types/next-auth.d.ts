import { Role } from "@/domain/enums/Role";
import { AuthProvider } from "@/domain/enums/AuthProvider";

/**
 * Augments the NextAuth Session and JWT types to include
 * Clipper-specific fields: id, role, provider.
 *
 * This makes session.user.role strongly typed throughout the app.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      provider: AuthProvider;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role: Role;
    provider: AuthProvider;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    provider: AuthProvider;
  }
}
