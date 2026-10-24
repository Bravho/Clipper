import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

/** `/pricing` is the address people guess; the public price list lives at /plans. */
export default function PricingAliasPage() {
  redirect(ROUTES.PUBLIC_PRICING);
}
