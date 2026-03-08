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

export const metadata: Metadata = { title: "My Account" };

const roleBadge: Record<Role, "blue" | "green" | "red"> = {
  [Role.Requester]: "blue",
  [Role.Staff]: "green",
  [Role.Admin]: "red",
};

export default async function AccountPage() {
  const user = await requireAuth();
  const profile = await accountService.getAccountProfile(user.id);

  // Only Terms and Privacy are presented to users at signup.
  // Privacy Policy covers ownership rights and storage retention.
  const policyTypes = [PolicyType.TermsOfService, PolicyType.PrivacyPolicy];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">My Account</h1>
        <p className="mt-1 text-slate-500">Your profile and account details.</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label="Full name" value={profile.user.name} />
            <Row label="Email" value={profile.user.email} />
            <Row
              label="Role"
              value={
                <Badge variant={roleBadge[profile.user.role]}>
                  {profile.user.role}
                </Badge>
              }
            />
            <Row
              label="Sign-in method"
              value={
                <span className="capitalize">
                  {user.provider === AuthProvider.Google ? "Google" : "Email / Password"}
                </span>
              }
            />
            <Row
              label="Member since"
              value={profile.user.createdAt.toLocaleDateString("en-GB", {
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
              <CardTitle>Credits</CardTitle>
            </CardHeader>
            {profile.wallet ? (
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl font-bold text-blue-700">
                  {profile.wallet.balance}
                </div>
                <div>
                  <p className="font-semibold text-slate-900">
                    {profile.wallet.balance} credit{profile.wallet.balance !== 1 ? "s" : ""}
                  </p>
                  <p className="text-sm text-slate-500">
                    Each clip request costs 10 credits.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No wallet found.</p>
            )}
          </Card>
        )}

        {/* Legal acceptances */}
        <Card>
          <CardHeader>
            <CardTitle>Policy Acceptances</CardTitle>
          </CardHeader>
          {profile.acceptances.length === 0 ? (
            <p className="text-sm text-slate-500">No policy acceptances on record.</p>
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
                          ? "Terms of Service"
                          : "Privacy Policy (incl. Ownership & Storage)"}
                      </p>
                      {acceptance && (
                        <p className="text-xs text-slate-400">
                          Accepted v{acceptance.policyVersion} on{" "}
                          {acceptance.acceptedAt.toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {acceptance ? (
                      acceptance.policyVersion === currentVersion ? (
                        <Badge variant="green">Current</Badge>
                      ) : (
                        <Badge variant="yellow">Update needed</Badge>
                      )
                    ) : (
                      <Badge variant="red">Not accepted</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Placeholder: Profile edit */}
        <Card className="border-dashed">
          <p className="text-sm font-medium text-slate-500">
            Profile editing, password change, and connected account management
            will be available in a future update.
          </p>
        </Card>

        {/* Sign out */}
        <div className="flex justify-end">
          <SignOutButton />
        </div>
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
