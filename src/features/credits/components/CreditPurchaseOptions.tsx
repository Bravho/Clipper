"use client";

import { useEffect, useState } from "react";
import { isNativeMobile } from "@/lib/mobile/platform";
import { PromptPayTopup } from "@/features/credits/components/PromptPayTopup";
import { MobileStoreTopup } from "@/features/credits/components/MobileStoreTopup";

interface Props {
  currentBalance: number;
  unlockRequestId?: string;
  returnTo?: string;
  unlockPrice: number;
}

export function CreditPurchaseOptions(props: Props) {
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => setNative(isNativeMobile()), []);

  if (native === null) {
    return <div className="h-32 animate-pulse rounded-xl bg-slate-100" />;
  }
  return native ? <MobileStoreTopup /> : <PromptPayTopup {...props} />;
}

