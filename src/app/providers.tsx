"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { I18nProvider } from "@/i18n/client";
import type { AppLocale } from "@/i18n/config";

/**
 * Client-side SessionProvider wrapper.
 * Must be a client component — imported by the server layout.
 */
export default function SessionProvider({
  children,
  session,
  locale,
}: {
  children: React.ReactNode;
  session: Session | null;
  locale: AppLocale;
}) {
  return (
    <NextAuthSessionProvider session={session}>
      <I18nProvider initialLocale={locale}>{children}</I18nProvider>
    </NextAuthSessionProvider>
  );
}
