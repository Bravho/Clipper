import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

/**
 * Retired Oct 2026: "Approval clicks" measured review gates that no longer
 * need anyone's approval. Its successor is Studio Activity; the old page and
 * service are kept in _to_delete/admin-approval-analytics-oct2026/.
 */
export default function RetiredApprovalAnalyticsPage() {
  redirect(ROUTES.ADMIN_ANALYTICS_STUDIO);
}
