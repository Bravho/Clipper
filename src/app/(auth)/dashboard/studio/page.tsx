import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

export default function StudioPage() {
  redirect(ROUTES.STUDIO_BRANDS);
}
