"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/client";

/**
 * Social connections manager.
 *
 * CONNECTING IS FREE — this screen shows no prices and no paywall. Users set up
 * their accounts first and pay only when they publish.
 *
 * RClipper never sees a social password: the user authorises on the platform's
 * own site, and we store identifiers and display metadata only. That is stated
 * on screen, because "connect your account" is a moment where people reasonably
 * want to know what they are handing over.
 */

interface Connection {
  id: string;
  platform: string;
  platformLabel: string;
  accountName: string | null;
  accountUsername: string | null;
  avatarUrl: string | null;
  status: "pending" | "connected" | "disconnected" | "removed";
  connectedAt: string | null;
  lastSyncedAt: string | null;
}

interface AvailablePlatform {
  platform: string;
  label: string;
}

type Busy =
  | { kind: "idle" }
  | { kind: "connecting"; platform: string }
  | { kind: "row"; id: string; action: "refresh" | "disconnect" };

export function ConnectionsManager() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [platforms, setPlatforms] = useState<AvailablePlatform[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  // The OAuth callback redirects back here with a status in the query string —
  // it is the ONLY signal for a failed or cancelled authorisation, since the
  // provider sends no webhook for those.
  const callbackStatus = searchParams.get("connection");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/management/social-accounts");
      if (!response.ok) throw new Error();
      const data = await response.json();
      setConnections(data.connections ?? []);
      setPlatforms(data.availablePlatforms ?? []);
    } catch {
      setError(t("management.connectionsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(platform: string) {
    setBusy({ kind: "connecting", platform });
    setError(null);
    try {
      const response = await fetch("/api/management/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.authorizationUrl) {
        setError(t("management.connectFailed"));
        setBusy({ kind: "idle" });
        return;
      }
      // Full navigation, not a popup: the platform's consent screens routinely
      // refuse to render inside one.
      window.location.href = data.authorizationUrl;
    } catch {
      setError(t("management.connectFailed"));
      setBusy({ kind: "idle" });
    }
  }

  async function refresh(id: string) {
    setBusy({ kind: "row", id, action: "refresh" });
    try {
      await fetch(`/api/management/social-accounts/${id}`, { method: "POST" });
      await load();
      router.refresh();
    } finally {
      setBusy({ kind: "idle" });
    }
  }

  async function disconnect(id: string) {
    setBusy({ kind: "row", id, action: "disconnect" });
    try {
      await fetch(`/api/management/social-accounts/${id}`, { method: "DELETE" });
      await load();
      router.refresh();
    } finally {
      setBusy({ kind: "idle" });
    }
  }

  const live = connections.filter((c) => c.status !== "removed");
  const connectedCount = live.filter((c) => c.status === "connected").length;
  const attentionCount = live.length - connectedCount;

  return (
    <div className="space-y-5">
      {callbackStatus && <CallbackBanner status={callbackStatus} />}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 flex-none" />
          <p>{error}</p>
        </div>
      )}

      {/* Includes incomplete attempts as well as real connections, so the
          heading and counters must not imply that every row is publishable. */}
      {live.length > 0 && (
        <Card padding="none" className="overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                {t("management.connections")}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {connectedCount} {t("management.statusConnected")}
                {attentionCount > 0
                  ? ` · ${attentionCount} ${t("management.statusPending")}`
                  : ""}
              </p>
            </div>
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-blue-50 px-2 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-100">
              {connectedCount}
            </span>
          </div>

          <ul className="divide-y divide-slate-100">
            {live.map((c) => (
              <li
                key={c.id}
                className="group px-5 py-4 transition-colors hover:bg-slate-50/70 sm:flex sm:items-center sm:gap-4 sm:px-6"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <AccountAvatar connection={c} />

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {c.accountUsername || c.accountName || c.platformLabel}
                      </p>
                      <span className="hidden sm:inline-flex">
                        <StatusBadge status={c.status} />
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{c.platformLabel}</p>
                    {c.status === "pending" && (
                      <p className="mt-1 text-xs text-amber-700">
                        {t("management.pendingHint")}
                      </p>
                    )}
                  </div>

                  <div className="sm:hidden">
                    <StatusBadge status={c.status} compact />
                  </div>
                </div>

                <div className="mt-3 flex flex-none items-center justify-end gap-1 border-t border-slate-100 pt-3 sm:mt-0 sm:border-0 sm:pt-0">
                  {(c.status === "pending" || c.status === "disconnected") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mr-auto rounded-lg"
                      disabled={busy.kind !== "idle"}
                      onClick={() => connect(c.platform)}
                    >
                      {t("management.reconnect")}
                    </Button>
                  )}
                  {/* Shown on PENDING rows too. Refresh now asks the provider
                      whether the account was in fact authorised, which is the
                      only way out of an attempt whose browser callback never
                      arrived — hiding it here left "Reconnect" as the sole
                      option, and that just created a second stranded row. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg text-slate-600"
                    disabled={busy.kind !== "idle"}
                    onClick={() => refresh(c.id)}
                  >
                    <RefreshIcon
                      className={`h-4 w-4 ${
                        busy.kind === "row" &&
                        busy.id === c.id &&
                        busy.action === "refresh"
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                    {t("management.refresh")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                    disabled={busy.kind !== "idle"}
                    onClick={() => disconnect(c.id)}
                  >
                    {t("management.disconnect")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padding="none" className="overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <div className="px-5 py-5 sm:px-6">
          <h2 className="text-base font-semibold text-slate-950">
            {t("management.addAccount")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            {t("management.choosePlatform")}
          </p>

          {loading ? (
            <ConnectionGridSkeleton />
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {platforms.map((p) => {
                const isConnecting =
                  busy.kind === "connecting" && busy.platform === p.platform;

                return (
                  <button
                    key={p.platform}
                    type="button"
                    disabled={busy.kind === "connecting"}
                    onClick={() => connect(p.platform)}
                    className="group/tile flex min-h-20 items-center gap-3.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  >
                    <PlatformIcon platform={p.platform} className="h-11 w-11 flex-none" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-950">
                        {p.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {isConnecting
                          ? t("management.connecting")
                          : t("management.addAccount")}
                      </span>
                    </span>
                    {isConnecting ? (
                      <Spinner className="h-4 w-4 flex-none text-blue-600" />
                    ) : (
                      <ArrowUpRightIcon className="h-4 w-4 flex-none text-slate-400 transition-colors group-hover/tile:text-blue-600" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 border-t border-blue-100 bg-blue-50/70 px-5 py-4 sm:px-6">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-blue-100">
            <ShieldCheckIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-900">
              {t("management.secureConnection")}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-slate-600">
              {t("management.neverStorePasswords")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AccountAvatar({ connection }: { connection: Connection }) {
  return (
    <span className="relative flex h-11 w-11 flex-none items-center justify-center">
      {connection.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={connection.avatarUrl}
          alt=""
          className="h-11 w-11 rounded-xl object-cover ring-1 ring-slate-200"
        />
      ) : (
        <PlatformIcon platform={connection.platform} className="h-11 w-11" />
      )}
      {connection.avatarUrl && (
        <PlatformIcon
          platform={connection.platform}
          className="absolute -bottom-1 -right-1 h-5 w-5 rounded-md ring-2 ring-white"
        />
      )}
    </span>
  );
}

function StatusBadge({
  status,
  compact = false,
}: {
  status: Connection["status"];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const styles: Record<string, string> = {
    connected: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    disconnected: "bg-amber-50 text-amber-800 ring-amber-600/15",
    pending: "bg-amber-50 text-amber-800 ring-amber-600/15",
    removed: "bg-slate-100 text-slate-400 ring-slate-500/10",
  };
  const labels: Record<string, string> = {
    connected: t("management.statusConnected"),
    disconnected: t("management.statusDisconnected"),
    pending: t("management.statusPending"),
    removed: t("management.statusRemoved"),
  };
  return (
    <span
      title={labels[status] ?? status}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
        styles[status] ?? styles.pending
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "connected"
            ? "bg-emerald-500"
            : status === "disconnected"
              ? "bg-amber-500"
              : status === "pending"
                ? "bg-amber-500"
                : "bg-slate-400"
        }`}
      />
      {!compact && (labels[status] ?? status)}
    </span>
  );
}

/**
 * Result of the OAuth round trip.
 *
 * Every branch maps to a friendly message — a raw provider error is never shown,
 * and "rejected" deliberately says little, because the detail (an ownership
 * mismatch) is a security signal that belongs in the server log.
 */
function CallbackBanner({ status }: { status: string }) {
  const { t } = useI18n();

  const success = status === "success";
  const message =
    status === "success"
      ? t("management.connectSuccess")
      : status === "none"
        ? t("management.connectNone")
        : status === "account_claimed"
          ? t("management.connectClaimed")
          : t("management.connectFailed");

  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      {success ? (
        <CheckCircleIcon className="mt-0.5 h-4 w-4 flex-none" />
      ) : (
        <AlertIcon className="mt-0.5 h-4 w-4 flex-none" />
      )}
      <p>{message}</p>
    </div>
  );
}

function ConnectionGridSkeleton() {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="flex min-h-20 animate-pulse items-center gap-3.5 rounded-xl border border-slate-200 p-3"
        >
          <span className="h-11 w-11 rounded-xl bg-slate-100" />
          <span className="flex-1">
            <span className="block h-3 w-24 rounded bg-slate-100" />
            <span className="mt-2 block h-2.5 w-16 rounded bg-slate-100" />
          </span>
        </div>
      ))}
    </div>
  );
}

function PlatformIcon({
  platform,
  className = "",
}: {
  platform: string;
  className?: string;
}) {
  const baseClass = `flex items-center justify-center rounded-xl ${className}`;

  if (platform === "facebook") {
    return (
      <span className={`${baseClass} bg-[#1877F2] text-white`}>
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M13.7 21v-8h2.8l.4-3.1h-3.2v-2c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.5V13h2.8v8h3.4Z"
          />
        </svg>
      </span>
    );
  }

  if (platform === "instagram") {
    return (
      <span
        className={`${baseClass} bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 text-white`}
      >
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" aria-hidden="true">
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="17"
            rx="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle
            cx="12"
            cy="12"
            r="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="17.5" cy="6.7" r="1.1" fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (platform === "youtube") {
    return (
      <span className={`${baseClass} bg-[#FF0033] text-white`}>
        <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.2V8.8l5.5 3.2-5.5 3.2Z"
          />
        </svg>
      </span>
    );
  }

  if (platform === "tiktok" || platform === "tiktok_business") {
    return (
      <span className={`${baseClass} bg-slate-950 text-white`}>
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" aria-hidden="true">
          <path
            fill="#25F4EE"
            d="M14.4 4.1v10.2a4.2 4.2 0 1 1-3.7-4.2v2.3a1.9 1.9 0 1 0 1.4 1.9V2h2.3c.2 1.8 1.3 3.3 3 4.1v2.5a7.2 7.2 0 0 1-3-1.2V4.1Z"
            transform="translate(-.7 .3)"
          />
          <path
            fill="#FE2C55"
            d="M14.4 4.1v10.2a4.2 4.2 0 1 1-3.7-4.2v2.3a1.9 1.9 0 1 0 1.4 1.9V2h2.3c.2 1.8 1.3 3.3 3 4.1v2.5a7.2 7.2 0 0 1-3-1.2V4.1Z"
            transform="translate(.7 -.3)"
          />
          <path
            fill="currentColor"
            d="M14.4 4.1v10.2a4.2 4.2 0 1 1-3.7-4.2v2.3a1.9 1.9 0 1 0 1.4 1.9V2h2.3c.2 1.8 1.3 3.3 3 4.1v2.5a7.2 7.2 0 0 1-3-1.2V4.1Z"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className={`${baseClass} bg-slate-900 text-xs font-bold text-white`}>
      {platform.slice(0, 2).toUpperCase()}
    </span>
  );
}

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldCheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3 4.5 6v5.1c0 4.6 3.1 8.8 7.5 9.9 4.4-1.1 7.5-5.3 7.5-9.9V6L12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m8.5 12 2.2 2.2 4.8-4.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckCircleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M20 11.1V12a8 8 0 1 1-4.7-7.3M20 5l-9 9-3-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 8v4m0 4h.01M10.3 4.4 2.8 17.2A1.9 1.9 0 0 0 4.5 20h15a1.9 1.9 0 0 0 1.7-2.8L13.7 4.4a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
