import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/helpers";
import { isAdLabEnabledFor } from "@/config/adLab";
import { AdLabShell } from "@/features/ad-lab/AdLabShell";

export const dynamic = "force-dynamic";

export default async function AdLabLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  if (!isAdLabEnabledFor({ id: user.id, email: user.email })) notFound();

  return <AdLabShell>{children}</AdLabShell>;
}
