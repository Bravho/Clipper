import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { rich } from "@/i18n/rich";

export const metadata: Metadata = {
  title: "Support — RClipper",
  description:
    "Contact RClipper support. Email us with questions about your account, credits, video requests, publishing, billing, or account deletion.",
};

const SUPPORT_EMAIL = "pillarth@gmail.com";

function mailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** The FAQ, as catalogue keys: the page reads in the language picked in the menu. */
const FAQ_KEYS = ["time", "credits", "signin", "social", "delete", "refund"] as const;

const TOPICS: Array<{ label: MessageKey; subject: string }> = [
  { label: "support.topic.account", subject: "Account help" },
  { label: "support.topic.billing", subject: "Billing question" },
  { label: "support.topic.request", subject: "Video request issue" },
  { label: "support.topic.publishing", subject: "Publishing issue" },
  { label: "support.topic.content", subject: "Content or privacy request" },
  { label: "support.topic.deletion", subject: "Account deletion request" },
];

export default function SupportPage() {
  const { t } = getServerI18n();
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">{t("footer.support")}</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          {t("support.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{t("support.lead")}</p>
      </div>

      {/* Primary contact */}
      <Card>
        <h2 className="text-base font-semibold text-slate-900">
          {t("support.contact")}
        </h2>
        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-900">{t("account.email")}</dt>
            <dd className="mt-1">
              <a
                href={mailto("RClipper support request")}
                className="text-blue-700 underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              {t("support.responseTime")}
            </dt>
            <dd className="mt-1 text-slate-700">{t("support.responseBody")}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              {t("support.hours")}
            </dt>
            <dd className="mt-1 text-slate-700">{t("support.hoursBody")}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              {t("support.languages")}
            </dt>
            <dd className="mt-1 text-slate-700">ไทย · English</dd>
          </div>
        </dl>
      </Card>

      {/* What to include */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          {t("support.include")}
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
          <li>{t("support.include1")}</li>
          <li>{t("support.include2")}</li>
          <li>{t("support.include3")}</li>
          <li>{t("support.include4")}</li>
          <li>{t("support.include5")}</li>
        </ul>
      </Card>

      {/* Quick links by topic */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          {t("support.byTopic")}
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {TOPICS.map((item) => (
            <a
              key={item.subject}
              href={mailto(item.subject)}
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
            >
              {t(item.label)}
            </a>
          ))}
        </div>
      </Card>

      {/* FAQ */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          {t("support.faq")}
        </h2>
        <div className="mt-4 space-y-5">
          {FAQ_KEYS.map((id) => (
            <div key={id}>
              <h3 className="text-sm font-semibold text-slate-900">
                {t(`support.faq.${id}.q` as MessageKey)}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                {rich(t(`support.faq.${id}.a` as MessageKey), {
                  link: (
                    <Link href="/delete-account" className="text-blue-700 underline">
                      {t("support.deletionPage")}
                    </Link>
                  ),
                })}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Policies */}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-slate-900">
          {t("support.policies")}
        </h2>
        <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href={ROUTES.TERMS} className="text-blue-700 underline">
            {t("account.policyTerms")}
          </Link>
          <Link href={ROUTES.PRIVACY} className="text-blue-700 underline">
            {t("legal.privacy")}
          </Link>
          <Link href={ROUTES.OWNERSHIP} className="text-blue-700 underline">
            {t("legal.ownership")}
          </Link>
          <Link href="/delete-account" className="text-blue-700 underline">
            {t("delPage.title")}
          </Link>
          <Link href={ROUTES.LOGIN} className="text-blue-700 underline">
            {t("nav.signIn")}
          </Link>
        </nav>
      </Card>

      <p className="mt-6 text-xs leading-relaxed text-slate-500">
        {t("support.footer")}
      </p>
    </div>
  );
}
