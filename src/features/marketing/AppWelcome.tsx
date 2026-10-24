import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/config/routes";
import type { MessageKey } from "@/i18n/messages";
import { AppWelcomeStickyBar } from "./AppWelcomeStickyBar";

type T = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * The first screen inside the app for someone who is not signed in.
 *
 * It explains what RClipper is, who it is for and how it works before asking
 * for an account — instead of opening straight onto the sign-in form. The
 * actions stay in reach the whole time: once the hero's buttons scroll away,
 * a bar pinned to the bottom of the screen holds "sign in" and "get started".
 *
 * Server component; the browser home page (`app/(public)/page.tsx`) renders
 * this only for the app shell.
 */
export function AppWelcome({ t, freeTotal }: { t: T; freeTotal: number }) {
  const steps: { title: MessageKey; body: MessageKey }[] = [
    { title: "welcome.how.step1.title", body: "welcome.how.step1.body" },
    { title: "welcome.how.step2.title", body: "welcome.how.step2.body" },
    { title: "welcome.how.step3.title", body: "welcome.how.step3.body" },
    { title: "welcome.how.step4.title", body: "welcome.how.step4.body" },
  ];

  const features: { icon: ReactNode; title: MessageKey; body: MessageKey }[] = [
    { icon: <IconSparkle />, title: "mkt.feature.script.title", body: "mkt.feature.script.body" },
    { icon: <IconMic />, title: "mkt.feature.voice.title", body: "mkt.feature.voice.body" },
    { icon: <IconCaptions />, title: "mkt.feature.captions.title", body: "mkt.feature.captions.body" },
    { icon: <IconFrames />, title: "mkt.feature.shapes.title", body: "mkt.feature.shapes.body" },
    { icon: <IconSend />, title: "mkt.feature.publish.title", body: "mkt.feature.publish.body" },
  ];

  const audiences: MessageKey[] = [
    "mkt.audience.restaurants",
    "mkt.audience.hotels",
    "mkt.audience.tours",
    "mkt.audience.shops",
  ];

  return (
    <div className="flex flex-col bg-white text-slate-900">
      {/* Hero */}
      <section className="relative overflow-hidden px-5 pb-10 pt-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-blue-50 via-white to-white"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-blue-200/40 blur-3xl"
        />
        <div className="relative mx-auto max-w-md">
          {/* The app bar above already carries the logo and name. */}
          <p className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
            {t("mkt.hero.eyebrow")}
          </p>
          <h1 className="mt-4 text-[1.9rem] font-bold leading-[1.15] tracking-tight">
            {t("welcome.title")}{" "}
            <span className="text-blue-700">{t("welcome.titleAccent")}</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">{t("welcome.subtitle")}</p>

          <PreviewCard t={t} />

          <div id="welcome-hero-actions" className="mt-8 flex flex-col gap-3">
            <PrimaryButton href={ROUTES.SIGNUP}>{t("welcome.ctaPrimary")}</PrimaryButton>
            <SecondaryButton href={ROUTES.LOGIN}>{t("welcome.ctaSecondary")}</SecondaryButton>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">{t("welcome.freeNote", { freeTotal })}</p>
          <p className="mt-3 text-center">
            <Link
              href={ROUTES.PUBLIC_PRICING}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
            >
              {t("welcome.pricingLink")} ›
            </Link>
          </p>
        </div>
      </section>

      {/* What it does + who it's for */}
      <section className="border-t border-slate-100 px-5 py-10">
        <div className="mx-auto max-w-md">
          <SectionTitle>{t("welcome.what.title")}</SectionTitle>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{t("welcome.what.body")}</p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("mkt.audience.title")}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {audiences.map((key) => (
              <li
                key={key}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
              >
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 px-5 py-10">
        <div className="mx-auto max-w-md">
          <SectionTitle>{t("welcome.how.title")}</SectionTitle>
          <p className="mt-2 text-sm text-slate-500">{t("welcome.how.body")}</p>
          <ol className="mt-7">
            {steps.map((step, index) => (
              <li key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
                {index < steps.length - 1 && (
                  <span aria-hidden className="absolute left-[17px] top-10 h-[calc(100%-2.5rem)] w-px bg-slate-300" />
                )}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-semibold text-white shadow-sm">
                  {index + 1}
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-snug">{t(step.title)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{t(step.body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="px-5 py-10">
        <div className="mx-auto max-w-md">
          <SectionTitle>{t("mkt.features.title")}</SectionTitle>
          <p className="mt-2 text-sm text-slate-500">{t("mkt.features.body")}</p>
          <ul className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {features.map((feature) => (
              <li key={feature.title} className="flex gap-4 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                  {feature.icon}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold leading-snug">{t(feature.title)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{t(feature.body)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Privacy */}
      <section className="px-5 pb-10">
        <div className="mx-auto flex max-w-md gap-4 rounded-2xl bg-slate-900 p-5 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
            <IconShield />
          </span>
          <div>
            <h3 className="font-semibold leading-snug">{t("welcome.privacy.title")}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{t("welcome.privacy.body")}</p>
          </div>
        </div>
      </section>

      {/* Scan a shop's QR — works without an account */}
      <section className="px-5 pb-10">
        <Link
          href={ROUTES.SCAN}
          className="mx-auto flex max-w-md items-center gap-4 rounded-2xl border border-slate-200 p-4 active:bg-slate-50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <IconQr />
          </span>
          <span className="flex-1">
            <span className="block text-sm text-slate-500">{t("welcome.scan.lead")}</span>
            <span className="block text-[15px] font-semibold text-slate-900">{t("welcome.scan.cta")}</span>
          </span>
          <span aria-hidden className="text-slate-400">
            ›
          </span>
        </Link>
      </section>

      {/* Closing call to action — bottom padding leaves room for the pinned bar */}
      <section className="border-t border-slate-100 px-5 pb-28 pt-10 text-center">
        <div className="mx-auto max-w-md">
          <SectionTitle>{t("welcome.ready.title")}</SectionTitle>
          <p className="mt-2 text-sm text-slate-500">{t("welcome.ready.body")}</p>
        </div>
      </section>

      {/* Pinned actions — appear once the hero buttons scroll away */}
      <AppWelcomeStickyBar watchId="welcome-hero-actions">
        <div className="mx-auto flex max-w-md gap-3">
          <SecondaryButton href={ROUTES.LOGIN} compact>
            {t("nav.signIn")}
          </SecondaryButton>
          <PrimaryButton href={ROUTES.SIGNUP} compact>
            {t("nav.getStarted")}
          </PrimaryButton>
        </div>
      </AppWelcomeStickyBar>
    </div>
  );
}

/** A small, static picture of what the app makes: a 9:16 frame with voice and captions. */
function PreviewCard({ t }: { t: T }) {
  return (
    <div className="mt-8 flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
      <div
        aria-hidden
        className="relative h-[148px] w-[84px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.45),transparent_55%)]" />
        <div className="absolute inset-x-1.5 top-1.5 flex gap-0.5">
          <span className="h-0.5 flex-1 rounded bg-white" />
          <span className="h-0.5 flex-1 rounded bg-white" />
          <span className="h-0.5 flex-1 rounded bg-white/40" />
        </div>
        <div className="absolute inset-x-1.5 bottom-2 rounded bg-black/55 px-1 py-0.5 text-center text-[7px] font-medium leading-tight text-white">
          {t("welcome.preview.caption")}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("welcome.preview.label")}</p>
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <span className="text-blue-700">
            <IconMic small />
          </span>
          {t("welcome.preview.voice")}
        </div>
        <div aria-hidden className="mt-2 flex h-6 items-end gap-[3px]">
          {[40, 70, 55, 90, 60, 80, 45, 65, 85, 50, 70, 35, 60, 75].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-blue-600/70" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <span className="text-blue-700">
            <IconCaptions small />
          </span>
          <span className="truncate">{t("welcome.preview.langs")}</span>
        </div>
        <div className="mt-3 flex gap-1.5">
          {["9:16", "4:5", "16:9"].map((r) => (
            <span key={r} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              {r}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-bold tracking-tight">{children}</h2>;
}

function PrimaryButton({ href, children, compact }: { href: string; children: ReactNode; compact?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[48px] items-center justify-center rounded-xl bg-blue-700 px-5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 active:bg-blue-900 ${
        compact ? "flex-1" : "w-full"
      }`}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ href, children, compact }: { href: string; children: ReactNode; compact?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[48px] items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-800 transition-colors hover:bg-slate-50 active:bg-slate-100 ${
        compact ? "flex-1" : "w-full"
      }`}
    >
      {children}
    </Link>
  );
}

/* Icons — inline, stroke-based, 20px (16px when small). */

function Svg({ children, small }: { children: ReactNode; small?: boolean }) {
  const size = small ? 16 : 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function IconSparkle() {
  return (
    <Svg>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </Svg>
  );
}

function IconMic({ small }: { small?: boolean }) {
  return (
    <Svg small={small}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  );
}

function IconCaptions({ small }: { small?: boolean }) {
  return (
    <Svg small={small}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 13h4M13 13h4M7 16h7" />
    </Svg>
  );
}

function IconFrames() {
  return (
    <Svg>
      <rect x="3" y="7" width="8" height="13" rx="1.5" />
      <rect x="13" y="4" width="8" height="9" rx="1.5" />
    </Svg>
  );
}

function IconSend() {
  return (
    <Svg>
      <path d="M21 3L10 14" />
      <path d="M21 3l-7 18-4-7-7-4z" />
    </Svg>
  );
}

function IconShield() {
  return (
    <Svg>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

function IconQr() {
  return (
    <Svg>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v.01M14 21h7v-4" />
    </Svg>
  );
}
