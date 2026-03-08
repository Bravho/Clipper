"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";

export function SignOutButton() {
  return (
    <Button
      variant="danger"
      onClick={() => signOut({ callbackUrl: ROUTES.HOME })}
    >
      Sign out
    </Button>
  );
}
