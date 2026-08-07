"use client";

import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";
import { signOutEverywhere } from "@/lib/mobile/signOutEverywhere";

export function SignOutButton() {
  return (
    <Button
      variant="danger"
      onClick={() => void signOutEverywhere(ROUTES.HOME)}
    >
      ออกจากระบบ
    </Button>
  );
}
