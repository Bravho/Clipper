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

export const metadata: Metadata = { title: "บัญชีของฉัน" };

const roleBadge: Record<Role, "blue" | "green" | "red"> = {
  [Role.Requester]: "blue",
  [Role.Admin]: "red",
};

const roleLabel: Record<Role, string> = {
  [Role.Requester]: "ผู้ใช้งาน",
  [Role.Admin]: "Admin",
};

export default async function AccountPage() {
  const user = await requireAuth();
  const profile = await accountService.getAccountProfile(user.id);

  const policyTypes = [PolicyType.TermsOfService, PolicyType.PrivacyPolicy];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">บัญชีของฉัน</h1>
        <p className="mt-1 text-slate-500">ข้อมูลโปรไฟล์และบัญชีของคุณ</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle>โปรไฟล์</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label="ชื่อ-นามสกุล" value={profile.user.name} />
            <Row label="อีเมล" value={profile.user.email} />
            <Row
              label="บทบาท"
              value={
                <Badge variant={roleBadge[profile.user.role]}>
                  {roleLabel[profile.user.role]}
                </Badge>
              }
            />
            <Row
              label="วิธีเข้าสู่ระบบ"
              value={
                <span>
                  {user.provider === AuthProvider.Google ? "Google" : "อีเมล / รหัสผ่าน"}
                </span>
              }
            />
            <Row
              label="สมาชิกตั้งแต่"
              value={profile.user.createdAt.toLocaleDateString("th-TH", {
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
              <CardTitle>เครดิต</CardTitle>
            </CardHeader>
            {profile.wallet ? (
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl font-bold text-blue-700">
                  {profile.wallet.balance}
                </div>
                <div>
                  <p className="font-semibold text-slate-900">
                    {profile.wallet.balance} เครดิต
                  </p>
                  <p className="text-sm text-slate-500">
                    คำขอคลิปแต่ละรายการใช้ 10 เครดิต
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">ไม่พบกระเป๋าเครดิต</p>
            )}
          </Card>
        )}

        {/* Legal acceptances */}
        <Card>
          <CardHeader>
            <CardTitle>การยอมรับนโยบาย</CardTitle>
          </CardHeader>
          {profile.acceptances.length === 0 ? (
            <p className="text-sm text-slate-500">ไม่มีประวัติการยอมรับนโยบาย</p>
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
                          ? "ข้อกำหนดการใช้งาน"
                          : "นโยบายความเป็นส่วนตัว (รวมสิทธิ์และการจัดเก็บ)"}
                      </p>
                      {acceptance && (
                        <p className="text-xs text-slate-400">
                          ยอมรับเวอร์ชัน {acceptance.policyVersion} เมื่อ{" "}
                          {acceptance.acceptedAt.toLocaleDateString("th-TH")}
                        </p>
                      )}
                    </div>
                    {acceptance ? (
                      acceptance.policyVersion === currentVersion ? (
                        <Badge variant="green">เป็นปัจจุบัน</Badge>
                      ) : (
                        <Badge variant="yellow">ต้องอัปเดต</Badge>
                      )
                    ) : (
                      <Badge variant="red">ยังไม่ยอมรับ</Badge>
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
            การแก้ไขโปรไฟล์ การเปลี่ยนรหัสผ่าน และการจัดการบัญชีที่เชื่อมต่อ
            จะพร้อมใช้งานในอัปเดตถัดไป
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
