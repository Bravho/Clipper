"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import "./studio.css";

import { ROUTES } from "@/config/routes";
import { useStudioCapability } from "./StudioChrome";
import type { AppClient } from "@/lib/mobile/appUserAgent";
import { StudioI18nProvider, useStudioT } from "./studioI18n";

/**
 * One question decides the studio: is this the RClipper APP, or a web browser?
 *
 *   - Inside the app (Android or iOS): the studio opens and the video is made
 *     on the phone. No version check stands in the way; the editor itself says
 *     so at Render time if this install has no video engine at all.
 *   - In a web browser (desktop, or Safari/Chrome on a phone): "download the
 *     app", with the App Store and Google Play buttons.
 *
 * "The app" is recognised from EITHER witness, so a slow start-up can never
 * turn the installed app into "a browser": the user agent the server saw
 * (`RClipperNative/<platform>`, fixed in the build's config and never late),
 * or Capacitor's bridge on the page (with its own UA fallback and retry — see
 * `useStudioCapability`).
 *
 * In `next dev` a desktop browser is let through, so the editor can still be
 * worked on at a desk.
 */
export function StudioAppGate({
  children,
  appStoreUrl,
  playStoreUrl,
  appClient = null,
}: {
  children: ReactNode;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
  /** What the request's user agent said (server-side): app or browser. */
  appClient?: AppClient | null;
}) {
  return (
    <StudioI18nProvider>
      <Gate appStoreUrl={appStoreUrl} playStoreUrl={playStoreUrl} appClient={appClient}>
        {children}
      </Gate>
    </StudioI18nProvider>
  );
}

function Gate({
  children,
  appStoreUrl,
  playStoreUrl,
  appClient,
}: {
  children: ReactNode;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
  appClient: AppClient | null;
}) {
  const t = useStudioT();
  const inAppByUserAgent = appClient?.platform != null;
  // Only asked when the server could not already tell (a browser, or an app
  // build whose user agent the server did not recognise).
  const capability = useStudioCapability();

  // Inside the app: straight into the studio, no waiting.
  if (inAppByUserAgent || capability?.isNative === true) return <>{children}</>;

  if (!capability) {
    return (
      <main className="studio">
        <section className="studio-panel">
          <p className="studio-note" aria-live="polite">
            {t("studio.gate.checking")}
          </p>
        </section>
      </main>
    );
  }

  if (process.env.NODE_ENV === "development") return <>{children}</>;

  // A web browser: the video is made in the app.
  return (
    <main className="studio">
      <section className="studio-panel">
        <h1 className="studio-panel-title">{t("studio.gate.browserTitle")}</h1>
        <p className="studio-panel-hint">{t("studio.gate.browserBody")}</p>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {appStoreUrl ? (
            <StoreButton href={appStoreUrl} label={t("studio.gate.appStore")} primary />
          ) : (
            <p className="studio-note">{t("studio.gate.appStoreSoon")}</p>
          )}
          {playStoreUrl ? (
            <StoreButton href={playStoreUrl} label={t("studio.gate.googlePlay")} primary />
          ) : (
            <p className="studio-note">{t("studio.gate.googlePlaySoon")}</p>
          )}
          <Link href={ROUTES.REQUESTS} className="studio-button studio-button-ghost">
            {t("studio.gate.myRequests")}
          </Link>
        </div>
      </section>
    </main>
  );
}

function StoreButton({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`studio-button ${primary ? "studio-button-primary" : "studio-button-ghost"}`}
    >
      {label}
    </a>
  );
}
