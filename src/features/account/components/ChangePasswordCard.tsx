"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n/client";

/**
 * Change-password card — rendered only for credentials (email/password)
 * accounts. OAuth accounts (Google/Apple) have no password.
 */
export function ChangePasswordCard() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError(t("password.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("password.mismatch"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("common.errorRetry"));
        return;
      }
      setSuccess(true);
      setOpen(false);
      reset();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("password.title")}</CardTitle>
      </CardHeader>

      {success && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {t("password.changed")}
        </div>
      )}

      {!open ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {t("password.changeHint")}
          </p>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("password.change")}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label={t("password.current")}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label={t("password.new")}
            type="password"
            autoComplete="new-password"
            hint={t("password.min8")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <Input
            label={t("password.confirmNew")}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

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
                reset();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={loading}>
              {t("password.save")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
