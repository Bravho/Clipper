import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { safeManagementReturnPath } from "@/config/routes";
import { managementProductRepository } from "@/repositories";
import { creditService } from "@/services/CreditService";
import { PackageTiers } from "@/features/pricing/components/PackageTiers";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * RClipper Management — publishing credit usage.
 *
 * Activating a package consumes credits from the user's existing wallet. Money
 * only enters the flow through the shared credit top-up UI; packages themselves
 * never present a separate payment checkout or renewal.
 */
export default async function ManagementPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { t } = getServerI18n();
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();

  const query = await searchParams;
  const returnTo = safeManagementReturnPath(
    Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo
  );

  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  if (!isManagementEnabledFor(user)) notFound();

  const [products, balanceCredits] = await Promise.all([
    managementProductRepository.listActive(),
    creditService.getBalance(user.id),
  ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8">
      <header className="mb-6">
        <Link
          href={returnTo}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Channel Management
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("mgmt.payments.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("mgmt.payments.body")}</p>
      </header>

      {/* The same Starter / Pro packages the pricing page sells: since
          2026-09-27 every package includes video making AND publishing, and
          the publishing-only passes are retired. */}
      <div className="mb-8">
        <PackageTiers
          t={t}
          rows={products}
          balanceCredits={balanceCredits}
          returnTo={returnTo}
          chrome
        />
      </div>
    </div>
  );
}
