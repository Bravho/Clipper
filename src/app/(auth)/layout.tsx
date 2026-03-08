import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

/**
 * Auth group layout.
 *
 * Belt-and-suspenders auth check alongside middleware.
 * Middleware handles the first gate; this layout provides
 * server-rendered protection for the (auth) route group.
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(ROUTES.LOGIN);
  }

  return <>{children}</>;
}
