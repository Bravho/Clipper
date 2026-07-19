"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";

export function SignOutButton() {
  const handleSignOut = async () => {
    const token = window.localStorage.getItem("rclipper-push-token");
    if (token) {
      try {
        await fetch("/api/mobile/push-device", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      } finally {
        window.localStorage.removeItem("rclipper-push-token");
      }
    }
    await signOut({ callbackUrl: ROUTES.HOME });
  };

  return (
    <Button
      variant="danger"
      onClick={() => void handleSignOut()}
    >
      ออกจากระบบ
    </Button>
  );
}
