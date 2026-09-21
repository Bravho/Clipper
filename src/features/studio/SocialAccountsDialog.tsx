"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { StudioSocialAccount } from "@/domain/models/Studio";
import { CHANNEL_ACCENT, CHANNEL_LABELS, channelForPlatform } from "./socialAccountChannels";

/**
 * Connect and attach social accounts for one Studio brand.
 *
 * Accounts are the real Channel Management connections (Post for Me OAuth) —
 * Studio never asks for a password and stores display metadata plus the
 * connection id only. Attaching is a Studio-side decision: the same connected
 * account may be used by more than one brand.
 *
 * THE AUTHORISATION SCREEN OPENS IN A NEW TAB, not this one. A full navigation
 * would discard the publishing form, including the chosen video file, which the
 * browser cannot restore afterwards.
 */

interface ApiConnection {
  id: string;
  platform: string;
  platformLabel: string;
  accountName: string | null;
  accountUsername: string | null;
  avatarUrl: string | null;
  status: "pending" | "connected" | "disconnected" | "removed";
}

interface ApiPlatform {
  platform: string;
  label: string;
}

interface SocialAccountsDialogProps {
  brandId: string;
  brandName: string;
  linkedAccounts: StudioSocialAccount[];
  onLink: (account: StudioSocialAccount) => void;
  onUnlink: (accountId: string) => void;
  onClose: () => void;
}

type Busy = { kind: "idle" } | { kind: "connecting"; platform: string };

export function SocialAccountsDialog({
  brandId,
  brandName,
  linkedAccounts,
  onLink,
  onUnlink,
  onClose,
}: SocialAccountsDialogProps) {
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [platforms, setPlatforms] = useState<ApiPlatform[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/management/social-accounts", { cache: "no-store" });
      if (response.status === 401) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
      if (response.status === 403 || response.status === 404) {
        throw new Error("บัญชีนี้ยังไม่ได้เปิดใช้งานการเชื่อมต่อช่องทาง โปรดติดต่อทีมงานเพื่อเปิดใช้งาน");
      }
      if (!response.ok) throw new Error("โหลดรายการบัญชีไม่สำเร็จ");
      const data = await response.json() as {
        connections?: ApiConnection[];
        availablePlatforms?: ApiPlatform[];
      };
      setConnections((data.connections ?? []).filter((item) => item.status !== "removed"));
      setPlatforms((data.availablePlatforms ?? []).filter((item) => channelForPlatform(item.platform)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดรายการบัญชีไม่สำเร็จ");
      setConnections([]);
      setPlatforms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function connect(platform: string) {
    setBusy({ kind: "connecting", platform });
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/management/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await response.json().catch(() => ({})) as { authorizationUrl?: string };
      if (!response.ok || !data.authorizationUrl) {
        setError("เริ่มการเชื่อมต่อไม่สำเร็จ โปรดลองใหม่อีกครั้ง");
        return;
      }
      const opened = window.open(data.authorizationUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        setError("เบราว์เซอร์บล็อกแท็บใหม่ โปรดอนุญาต pop-up แล้วลองอีกครั้ง");
        return;
      }
      setNotice("เปิดหน้าอนุญาตในแท็บใหม่แล้ว เมื่อเชื่อมต่อเสร็จให้กลับมาที่แท็บนี้แล้วกด “รีเฟรชรายการ”");
    } catch {
      setError("เริ่มการเชื่อมต่อไม่สำเร็จ โปรดลองใหม่อีกครั้ง");
    } finally {
      setBusy({ kind: "idle" });
    }
  }

  function link(connection: ApiConnection) {
    const channel = channelForPlatform(connection.platform);
    if (!channel) return;
    onLink({
      id: connection.id,
      brandId,
      channel,
      platform: connection.platform,
      platformLabel: connection.platformLabel,
      accountName: connection.accountName ?? "",
      accountUsername: connection.accountUsername ?? "",
      avatarUrl: connection.avatarUrl ?? "",
      status: connection.status === "removed" ? "disconnected" : connection.status,
      linkedAt: new Date().toISOString(),
    });
  }

  const linkedIds = new Set(linkedAccounts.map((account) => account.id));
  const publishable = connections.filter((connection) => channelForPlatform(connection.platform));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-accounts-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 id="studio-accounts-title" className="text-lg font-semibold text-slate-950">
              บัญชีโซเชียลของแบรนด์
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              เลือกบัญชีที่จะใช้กับแบรนด์ <span className="font-medium text-slate-700">{brandName}</span> หรือเชื่อมต่อบัญชีใหม่
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="-mr-2 -mt-1 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {notice && (
            <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              {notice}
            </p>
          )}

          <section>
            <h3 className="text-sm font-semibold text-slate-900">เชื่อมต่อบัญชีใหม่</h3>
            <p className="mt-1 text-xs text-slate-500">
              คุณจะอนุญาตบนเว็บไซต์ของแพลตฟอร์มเอง RClipper ไม่เคยเห็นรหัสผ่านของคุณ
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {platforms.length === 0 && !loading ? (
                <p className="text-sm text-slate-500">ยังไม่มีแพลตฟอร์มที่เปิดให้เชื่อมต่อ</p>
              ) : (
                platforms.map((item) => (
                  <Button
                    key={item.platform}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    loading={busy.kind === "connecting" && busy.platform === item.platform}
                    disabled={busy.kind !== "idle"}
                    onClick={() => connect(item.platform)}
                  >
                    + {item.label}
                  </Button>
                ))
              )}
            </div>
          </section>

          <section className="mt-6 border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">บัญชีที่เชื่อมต่อแล้ว</h3>
              <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
                รีเฟรชรายการ
              </Button>
            </div>

            {loading ? (
              <p className="mt-4 text-sm text-slate-500">กำลังโหลด…</p>
            ) : publishable.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                ยังไม่มีบัญชีที่เชื่อมต่อ เลือกแพลตฟอร์มด้านบนเพื่อเริ่ม
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {publishable.map((connection) => {
                  const channel = channelForPlatform(connection.platform)!;
                  const isLinked = linkedIds.has(connection.id);
                  return (
                    <li key={connection.id} className="flex items-center gap-3 px-4 py-3">
                      <AccountAvatar name={connection.accountUsername || connection.accountName || connection.platformLabel} url={connection.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {connection.accountUsername || connection.accountName || connection.platformLabel}
                        </p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CHANNEL_ACCENT[channel]}`}>
                            {CHANNEL_LABELS[channel]}
                          </span>
                          {connection.status !== "connected" && (
                            <span className="text-amber-700">
                              {connection.status === "pending" ? "รออนุญาตให้เสร็จ" : "การเชื่อมต่อหลุด"}
                            </span>
                          )}
                        </p>
                      </div>
                      {isLinked ? (
                        <Button variant="ghost" size="sm" onClick={() => onUnlink(connection.id)}>
                          นำออกจากแบรนด์
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={() => link(connection)}>
                          ใช้กับแบรนด์นี้
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <p className="text-xs text-slate-500">ใช้กับแบรนด์นี้แล้ว {linkedAccounts.length} บัญชี</p>
          <Button onClick={onClose}>เสร็จสิ้น</Button>
        </footer>
      </div>
    </div>
  );
}

function AccountAvatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- provider CDN hosts are not in the Next image allow-list.
    return <img src={url} alt="" className="h-9 w-9 flex-none rounded-full object-cover ring-1 ring-slate-200" />;
  }
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold uppercase text-slate-500">
      {name.replace(/^@/, "").charAt(0) || "?"}
    </span>
  );
}
