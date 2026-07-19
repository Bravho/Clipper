"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { startOAuth } from "@/lib/mobile/oauth";

interface AppleSignInButtonProps {
  callbackUrl?: string;
  label?: string;
}

export function AppleSignInButton({
  callbackUrl = "/dashboard",
  label = "ดำเนินการต่อด้วย Apple",
}: AppleSignInButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      await startOAuth("apple", callbackUrl);
    } catch {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      fullWidth
      loading={loading}
      onClick={handleAppleSignIn}
      className="gap-3 py-2.5"
    >
      {!loading && (
        <svg
          className="h-4 w-4 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M17.05 20.28c-.98.95-2.05.86-3.08.44-1.09-.44-2.09-.46-3.24 0-1.44.6-2.2.44-3.06-.44C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.79 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09h.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
      )}
      {label}
    </Button>
  );
}
