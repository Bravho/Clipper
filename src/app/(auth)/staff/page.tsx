import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

export default function RemovedStaffPage() {
  redirect(ROUTES.DASHBOARD);
}
