import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/helpers";
import { accountService } from "@/services/AccountService";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";
import { CURRENT_POLICY_VERSIONS } from "@/config/policyVersions";
import { PolicyType } from "@/domain/enums/PolicyType";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SignOutButton } from "./SignOutButton";
import { ChangePasswordCard } from "@/features/account/components/ChangePasswordCard";
import { DeleteAccountCard } from "@/features/account/components/DeleteAccountCard";
import { getServerI18n } from "@/i18n/server";
import { intlLocale } from "@/i18n/config";

export const metadata: Metadata = { title: "บัญชีของฉัน" };

const roleBadge: Record<Role, "blue" | "green" | "red"> = {
  [Role.Requester]: "blue",
  [Role.Admin]: "red",
};

export default async function AccountPage() {
  const { t, locale } = getServerI18n();
  const dateTag = intlLocale(locale);
  const user = await requireAuth();
  const profile = await accountService.getAccountProfile(user.id);

  const policyTypes = [PolicyType.TermsOfService, PolicyType.PrivacyPolicy];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{t("nav.account")}</h1>
        <p className="mt-1 text-slate-500">{t("account.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle>{t("account.profile")}</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label={t("account.name")} value={profile.user.name} />
            <Row label={t("account.email")} value={profile.user.email} />
            <Row
              label={t("account.role")}
              value={
                <Badge variant={roleBadge[profile.user.role]}>
                  {profile.user.role === Role.Admin ? "Admin" : t("account.roleRequester")}
                </Badge>
              }
            />
            <Row
              label={t("account.signInMethod")}
              value={
                <span>
                  {user.provider === AuthProvider.Google
                    ? "Google"
                    : user.provider === AuthProvider.Apple
                      ? "Apple"
                      : t("account.signInPassword")}
                </span>
              }
            />
            <Row
              label={t("account.memberSince")}
              value={profile.user.createdAt.toLocaleDateString(dateTag, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            />
          </dl>
        </Card>

        {/* Credits — only for requesters */}
        {profile.user.role === Role.Requester && (
          <Card>
            <CardHeader>
              <CardTitle>{t("sidebar.credits")}</CardTitle>
            </CardHeader>
            {profile.wallet ? (
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl font-bold text-blue-700">
                  {profile.wallet.balance}
                </div>
                <div>
                  <p className="font-semibold text-slate-900">
                    {t("dashboard.credits", { count: profile.wallet.balance })}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("account.noWallet")}</p>
            )}
          </Card>
        )}

        {/* Legal acceptances */}
        <Card>
          <CardHeader>
            <CardTitle>{t("account.policies")}</CardTitle>
          </CardHeader>
          {profile.acceptances.length === 0 ? (
            <p className="text-sm text-slate-500">{t("account.noPolicies")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {policyTypes.map((policyType) => {
                const acceptance = profile.acceptances.find(
                  (a) => a.policyType === policyType
                );
                const currentVersion = CURRENT_POLICY_VERSIONS[policyType].version;
                return (
                  <div
                    key={policyType}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {policyType === PolicyType.TermsOfService
                          ? t("account.policyTerms")
                          : t("account.policyPrivacy")}
                      </p>
                      {acceptance && (
                        <p className="text-xs text-slate-400">
                          {t("account.acceptedVersion", {
                            version: acceptance.policyVersion,
                            date: acceptance.acceptedAt.toLocaleDateString(dateTag),
                          })}
                        </p>
                      )}
                    </div>
                    {acceptance ? (
                      acceptance.policyVersion === currentVersion ? (
                        <Badge variant="green">{t("account.policyCurrent")}</Badge>
                      ) : (
                        <Badge variant="yellow">{t("account.policyOutdated")}</Badge>
                      )
                    ) : (
                      <Badge variant="red">{t("account.policyNotAccepted")}</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Change password — credentials accounts only (OAuth has no password) */}
        {user.provider === AuthProvider.Credentials && <ChangePasswordCard />}

        {/* Sign out */}
        <div className="flex justify-end">
          <SignOutButton />
        </div>

        {/* Danger zone: account deletion (App Store 5.1.1(v) / Play Store) */}
        {profile.user.role === Role.Requester && (
          <DeleteAccountCard
            hasPassword={user.provider === AuthProvider.Credentials}
          />
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
