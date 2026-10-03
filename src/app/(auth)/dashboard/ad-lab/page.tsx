import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

export default function AdLabPage() {
  redirect(ROUTES.AD_LAB_BRANDS);
}
