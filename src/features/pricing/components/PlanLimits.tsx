import { FREE_FACTS, perVideoLimits, tierFacts } from "@/config/planLimits";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * What each plan includes, and the limits every video has — side by side, in
 * the reader's language, from the configs that enforce them (config/planLimits).
 *
 * No hooks: server pages pass `getServerI18n().t`. Shown on the pricing page,
 * the credits page and the public /plans page, so a user sees the same limits
 * wherever they decide to pay.
 */
export function PlanComparison({ t }: { t: Translate }) {
  const starter = tierFacts("starter");
  const pro = tierFacts("pro");

  const plans: {
    key: string;
    name: string;
    price: string;
    highlight: boolean;
    lines: string[];
  }[] = [
    {
      key: "free",
      name: t("limits.free.name"),
      price: t("limits.free.price"),
      highlight: false,
      lines: [
        t("limits.free.videos", { videos: FREE_FACTS.videos, days: FREE_FACTS.days }),
        t("limits.free.posting"),
        t("limits.free.window", { days: FREE_FACTS.days }),
      ],
    },
    {
      key: "starter",
      name: t("pricing.tier.starter.name"),
      price: t("limits.tier.price", {
        price: starter.monthlyPrice.toLocaleString(),
        lowest: starter.lowestPerMonth.toLocaleString(),
      }),
      highlight: false,
      lines: [
        t("limits.tier.videos", { videos: starter.videosPerMonth }),
        t("limits.tier.posting"),
        t("limits.tier.noCarry"),
        t("limits.tier.terms"),
      ],
    },
    {
      key: "pro",
      name: t("pricing.tier.pro.name"),
      price: t("limits.tier.price", {
        price: pro.monthlyPrice.toLocaleString(),
        lowest: pro.lowestPerMonth.toLocaleString(),
      }),
      highlight: true,
      lines: [
        t("limits.tier.videos", { videos: pro.videosPerMonth }),
        t("limits.tier.posting"),
        t("limits.tier.noCarry"),
        t("limits.tier.terms"),
      ],
    },
  ];

  return (
    <section aria-labelledby="plan-comparison-title">
      <h2 id="plan-comparison-title" className="text-base font-semibold text-slate-900">
        {t("limits.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{t("limits.subtitle")}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.key}
            className={
              plan.highlight
                ? "rounded-xl border border-blue-300 bg-white p-4 ring-1 ring-blue-200"
                : "rounded-xl border border-slate-200 bg-white p-4"
            }
          >
            <p className="text-sm font-semibold text-slate-900">{plan.name}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{plan.price}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
              {plan.lines.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="mt-0.5 text-emerald-600">✓</span>
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <PerVideoLimits t={t} />
    </section>
  );
}

/** The limits that apply to every video, on every plan. */
export function PerVideoLimits({ t }: { t: Translate }) {
  const limits = perVideoLimits();
  const lines = [
    t("limits.video.items", { items: limits.maxItems }),
    t("limits.video.length", { seconds: limits.maxSeconds }),
    t("limits.video.voice", { makes: limits.voiceMakes }),
    t("limits.video.locked"),
    t("limits.video.shapes", { shapes: limits.shapes }),
    t("limits.video.originals", { days: limits.originalsDays }),
    t("limits.video.download", { days: limits.downloadDays }),
    t("limits.video.management", { days: limits.managementDays }),
    t("limits.video.platforms"),
  ];
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">{t("limits.video.title")}</p>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden className="mt-0.5">•</span>
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
