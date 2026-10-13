"use client";

import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";
import { signOutEverywhere } from "@/lib/mobile/signOutEverywhere";
import { useI18n } from "@/i18n/client";

export function SignOutButton() {
  const { t } = useI18n();
  return (
    <Button
      variant="danger"
      onClick={() => void signOutEverywhere(ROUTES.HOME)}
    >
      {t("nav.signOut")}
    </Button>
  );
}
