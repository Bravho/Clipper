import { NextResponse } from "next/server";
import { managementProductRepository } from "@/repositories";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/management/products
 *
 * The trusted catalogue, for rendering the package picker. Prices come from the
 * database — the client never supplies one, and the checkout route re-reads
 * them rather than trusting anything echoed back from here.
 */
export async function GET() {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  try {
    const products = await managementProductRepository.listActive();
    return NextResponse.json({
      products: products.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        productType: p.productType,
        durationMonths: p.durationMonths,
        // Entry-bundle terms: how many upload tokens and how long to spend them.
        // Null for access passes (unlimited publishing, no window).
        uploadAllowance: p.uploadAllowance,
        accessWindowDays: p.accessWindowDays,
        priceCredits: p.priceCredits,
        fullPriceCredits: p.fullPriceCredits,
        currency: p.currency,
        // Explicit, so the UI can never render a renewal affordance by mistake.
        autoRenew: false,
        oneTimePayment: true,
      })),
    });
  } catch (err) {
    return managementErrorResponse("GET /api/management/products", err);
  }
}
