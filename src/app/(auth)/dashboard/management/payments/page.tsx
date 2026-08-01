import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { safeManagementReturnPath } from "@/config/routes";
import { managementProductRepository } from "@/repositories";
import { creditService } from "@/services/CreditService";
import { PackagePicker } from "@/features/management/components/PackagePicker";

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
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <Link
          href={returnTo}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Channel Management
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Publishing packages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Use credits from your balance to activate publishing access. No
          separate payment and no automatic renewal.
        </p>
      </header>

      <div className="mb-8">
        <PackagePicker
          balanceCredits={balanceCredits}
          returnTo={returnTo}
          products={products.map((p) => ({
            code: p.code,
            name:
              p.productType === "single_video"
                ? `Starter Credit Pack (${p.uploadAllowance ?? 4} uploads)`
                : p.durationMonths === 12
                  ? "1-Year Publishing Access"
                  : `${p.durationMonths}-Month Publishing Access`,
            description:
              p.productType === "single_video"
                ? `Publishing one video to one channel consumes one upload. Use all ${p.uploadAllowance ?? 4} uploads within ${p.accessWindowDays ?? 30} days.`
                : `Activate unlimited publishing for ${p.durationMonths} months using credits from your balance.`,
            productType: p.productType,
            durationMonths: p.durationMonths,
            uploadAllowance: p.uploadAllowance,
            accessWindowDays: p.accessWindowDays,
            priceCredits: p.priceCredits,
            fullPriceCredits: p.fullPriceCredits,
          }))}
        />
      </div>
    </div>
  );
}
