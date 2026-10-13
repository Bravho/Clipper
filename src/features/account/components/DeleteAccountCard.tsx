"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ROUTES } from "@/config/routes";
import { signOutEverywhere } from "@/lib/mobile/signOutEverywhere";
import { useI18n } from "@/i18n/client";

interface DeleteAccountCardProps {
  /** True when the account signs in with email/password (password re-verify). */
  hasPassword: boolean;
}

/**
 * Danger-zone card: delete the account (App Store 5.1.1(v) / Play Store
 * User Data policy). Credentials accounts confirm with their password;
 * OAuth accounts type "DELETE". Signs the user out on success.
 */
export function DeleteAccountCard({ hasPassword }: DeleteAccountCardProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = hasPassword ? password.length > 0 : confirmText === "DELETE";

  const handleDelete = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasPassword ? { password } : { confirm: confirmText }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("common.errorRetry"));
        setLoading(false);
        return;
      }
      // Account is gone — end the session immediately, and clear the native
      // credential state too so a re-signup shows the account picker.
      await signOutEverywhere(ROUTES.HOME);
    } catch {
      setError(t("common.networkError"));
      setLoading(false);
    }
  };

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle>{t("deleteAccount.title")}</CardTitle>
      </CardHeader>

      {!open ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            {t("deleteAccount.hint")}
          </p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {t("deleteAccount.title")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">{t("deleteAccount.irreversible")}</p>
            <ul className="mt-2 list-disc pl-5">
              <li>{t("deleteAccount.point1")}</li>
              <li>{t("deleteAccount.point2")}</li>
              <li>{t("deleteAccount.point3")}</li>
              <li>{t("deleteAccount.point4")}</li>
            </ul>
          </div>

          {hasPassword ? (
            <Input
              label={t("deleteAccount.confirmPassword")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : (
            <Input
              label={t("deleteAccount.typeDelete")}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          )}

          {error && (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setConfirmText("");
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={loading}
              disabled={!canSubmit}
              onClick={handleDelete}
            >
              {t("deleteAccount.confirm")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
