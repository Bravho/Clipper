import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/helpers";
import { isStudioEnabledFor } from "@/config/studio";
import { StudioShell } from "@/features/studio/StudioShell";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  if (!isStudioEnabledFor({ id: user.id, email: user.email })) notFound();

  return <StudioShell>{children}</StudioShell>;
}
