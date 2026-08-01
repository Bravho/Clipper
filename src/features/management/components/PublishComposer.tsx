"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  managementContentPath,
  managementPaymentsPath,
  ROUTES,
} from "@/config/routes";
import {
  acceptedRatiosForPlatform,
  connectionMatchesSuggestedPlatform,
  defaultVariantForPlatform,
  isAspectRatioCompatibleWithPlatform,
} from "@/config/managementPublishing";
import { resolvePublishingCopyDefaults } from "@/lib/publishing/channelCopyPolicy";

export interface ComposerAsset {
  id: string;
  variant: string;
  aspectRatio: string | null;
}

export interface ComposerConnection {
  id: string;
  platform: string;
  label: string;
  accountName: string | null;
}

export interface ComposerSuggestion {
  platform: string;
  displayOrder: number;
  title: string | null;
  caption: string | null;
  hashtags: string[];
}

interface ComposerProps {
  contentId: string;
  title: string;
  defaultCaption: string | null;
  defaultHashtags: string[];
  assets: ComposerAsset[];
  connections: ComposerConnection[];
  suggestions: ComposerSuggestion[];
  /** An active access pass — unlimited publishing, spends no token. */
  unlimited: boolean;
  /** Spendable upload tokens when there is no pass. */
  tokensRemaining: number;
}

interface TargetState {
  assetId: string;
  title: string;
  caption: string;
  hashtagsText: string;
}

type PublishResult = {
  publication: { id: string; status: string };
  targets: { platform: string; status: string; errorCode: string | null }[];
};

/**
 * The publish composer.
 *
 * Collecting is free; this is the paid step. It never decides entitlement — it
 * asks the server, which re-checks and either publishes or answers 402 so the
 * pay-to-publish gate is shown. One token is spent per selected channel; an
 * access pass covers any number.
 */
export function PublishComposer(props: ComposerProps) {
  const router = useRouter();

  // The variants that fit each connected channel, so a landscape clip is never
  // offered to a vertical-only surface.
  const compatibleByConnection = useMemo(() => {
    const map = new Map<string, ComposerAsset[]>();
    for (const conn of props.connections) {
      const fits = props.assets.filter((a) =>
        isAspectRatioCompatibleWithPlatform(conn.platform, a.aspectRatio)
      );
      map.set(conn.id, fits.length > 0 ? fits : props.assets);
    }
    return map;
  }, [props.connections, props.assets]);

  const orderedConnections = useMemo(() => {
    const suggestionRank = (platform: string) => {
      const suggestion = props.suggestions.find((candidate) =>
        connectionMatchesSuggestedPlatform(platform, candidate.platform)
      );
      return suggestion?.displayOrder ?? Number.MAX_SAFE_INTEGER;
    };
    return props.connections
      .map((connection, index) => ({ connection, index }))
      .sort(
        (a, b) =>
          suggestionRank(a.connection.platform) - suggestionRank(b.connection.platform) ||
          a.index - b.index
      )
      .map(({ connection }) => connection);
  }, [props.connections, props.suggestions]);

  function suggestionFor(platform: string): ComposerSuggestion | null {
    return (
      props.suggestions.find((candidate) =>
        connectionMatchesSuggestedPlatform(platform, candidate.platform)
      ) ?? null
    );
  }

  function defaultAssetFor(connectionId: string, platform: string): string {
    const options = compatibleByConnection.get(connectionId) ?? props.assets;
    const preferred = defaultVariantForPlatform(platform);
    const match = options.find((a) => a.aspectRatio === preferred);
    return (match ?? options[0])?.id ?? "";
  }

  const [selected, setSelected] = useState<Record<string, TargetState>>({});
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [tokens, setTokens] = useState(props.tokensRemaining);
  const [busy, setBusy] = useState<"idle" | "publishing" | "buying">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  const selectedIds = Object.keys(selected);
  const targetCount = selectedIds.length;
  const entitled = props.unlimited || tokens >= targetCount;

  function toggle(conn: ComposerConnection) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[conn.id]) {
        delete next[conn.id];
      } else {
        const suggestion = suggestionFor(conn.platform);
        const copiedDefaults = resolvePublishingCopyDefaults({
          defaultCaption: props.defaultCaption,
          defaultHashtags: props.defaultHashtags,
          fallbackCaption: suggestion?.caption,
          fallbackHashtags: suggestion?.hashtags,
        });
        next[conn.id] = {
          assetId: defaultAssetFor(conn.id, conn.platform),
          title: suggestion?.title || props.title,
          caption: copiedDefaults.caption,
          hashtagsText: copiedDefaults.hashtags.join(" "),
        };
      }
      return next;
    });
  }

  function setTarget(connId: string, patch: Partial<TargetState>) {
    setSelected((prev) => ({ ...prev, [connId]: { ...prev[connId], ...patch } }));
  }

  async function buyBundle() {
    setBusy("buying");
    setError(null);
    try {
      const res = await fetch("/api/management/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: "management_single_video",
          idempotencyToken: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needTopup) {
          setError(
            `Not enough credits. You need ${data.requiredCredits}, you have ${data.balanceCredits}.`
          );
        } else {
          setError(data.error ?? "Purchase failed.");
        }
        return;
      }
      // The bundle's remaining allowance is the fresh token balance.
      if (data.uploadBundle) setTokens((t) => t + data.uploadBundle.totalAllowance);
    } catch {
      setError("Purchase failed. Please try again.");
    } finally {
      setBusy("idle");
    }
  }

  async function publish() {
    if (targetCount === 0) {
      setError("Select at least one channel.");
      return;
    }
    let scheduledAtIso: string | null = null;
    if (publishMode === "schedule") {
      if (!scheduledAtLocal) {
        setError("Choose a time to schedule.");
        return;
      }
      const when = new Date(scheduledAtLocal);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
        setError("The scheduled time must be at least a minute in the future.");
        return;
      }
      scheduledAtIso = when.toISOString();
    }

    setBusy("publishing");
    setError(null);
    try {
      const res = await fetch("/api/management/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId: props.contentId,
          publishMode: publishMode === "schedule" ? "scheduled" : "publish_now",
          scheduledAt: scheduledAtIso,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          targets: selectedIds.map((id) => ({
            socialConnectionId: id,
            managementContentAssetId: selected[id].assetId,
            caption: selected[id].caption || undefined,
            title: selected[id].title || undefined,
            hashtags: selected[id].hashtagsText
              .split(/[\s,]+/)
              .map((tag) => tag.replace(/^#/, "").trim())
              .filter(Boolean),
          })),
        }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setError("Publishing requires payment. Buy an upload bundle below, or an access pass.");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Publishing failed.");
        return;
      }
      setResult(data as PublishResult);
      // Tokens were spent server-side; reflect it locally.
      if (!props.unlimited) setTokens((t) => Math.max(0, t - targetCount));
      router.refresh();
    } catch {
      setError("Publishing failed. Please try again.");
    } finally {
      setBusy("idle");
    }
  }

  if (result) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-slate-900">Publication created</h2>
        <p className="mt-1 text-sm text-slate-500">Status: {result.publication.status}</p>
        <ul className="mt-3 divide-y divide-slate-100">
          {result.targets.map((t, i) => (
            <li key={i} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-700">{t.platform}</span>
              <span className="text-slate-500">
                {t.status}
                {t.errorCode ? ` · ${t.errorCode}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Link href={ROUTES.MANAGEMENT_CONTENT}>
            <Button variant="outline" size="sm">
              Back to library
            </Button>
          </Link>
          <Button size="sm" onClick={() => setResult(null)}>
            Publish again
          </Button>
        </div>
      </Card>
    );
  }

  if (props.connections.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-700">
          You have no connected channels yet. Connect an account first — it is free.
        </p>
        <Link href={ROUTES.MANAGEMENT_CONNECTIONS} className="mt-3 inline-block">
          <Button size="sm">Connect a channel</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Choose channels</h2>
        <p className="mb-3 text-sm text-slate-500">
          Suggested channels appear first, but nothing is selected automatically.
        </p>
        <ul className="space-y-3">
          {orderedConnections.map((conn) => {
            const target = selected[conn.id];
            const options = compatibleByConnection.get(conn.id) ?? props.assets;
            const accepted = acceptedRatiosForPlatform(conn.platform);
            const suggested = !!suggestionFor(conn.platform);
            return (
              <li key={conn.id} className="rounded-lg border border-slate-200 p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!target}
                    onChange={() => toggle(conn)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {conn.label}
                      {suggested && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                          Suggested
                        </span>
                      )}
                      {conn.accountName ? (
                        <span className="ml-2 font-normal text-slate-500">
                          {conn.accountName}
                        </span>
                      ) : null}
                    </p>
                    {accepted.length > 0 && (
                      <p className="text-xs text-slate-400">
                        accepts {accepted.join(", ")}
                      </p>
                    )}
                  </div>
                </label>

                {target && (
                  <div className="mt-3 space-y-2 pl-7">
                    <div>
                      <label className="text-xs font-medium text-slate-600">Variant</label>
                      <select
                        className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        value={target.assetId}
                        onChange={(e) => setTarget(conn.id, { assetId: e.target.value })}
                      >
                        {options.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.variant}
                            {a.aspectRatio ? ` (${a.aspectRatio})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600">Title</label>
                      <input
                        className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        value={target.title}
                        onChange={(e) => setTarget(conn.id, { title: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600">Caption</label>
                      <textarea
                        rows={2}
                        className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        placeholder="Caption for this channel…"
                        value={target.caption}
                        onChange={(e) => setTarget(conn.id, { caption: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600">Hashtags</label>
                      <input
                        className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        placeholder="#restaurant #travel"
                        value={target.hashtagsText}
                        onChange={(e) =>
                          setTarget(conn.id, { hashtagsText: e.target.value })
                        }
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">When to publish</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={publishMode === "now"}
              onChange={() => setPublishMode("now")}
            />
            Publish now
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={publishMode === "schedule"}
              onChange={() => setPublishMode("schedule")}
            />
            Schedule
          </label>
          {publishMode === "schedule" && (
            <input
              type="datetime-local"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={scheduledAtLocal}
              onChange={(e) => setScheduledAtLocal(e.target.value)}
            />
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-700">
            {props.unlimited ? (
              <>Publishing {targetCount} channel{targetCount === 1 ? "" : "s"} · unlimited access</>
            ) : (
              <>
                {targetCount} channel{targetCount === 1 ? "" : "s"} · costs {targetCount} token
                {targetCount === 1 ? "" : "s"} · {tokens} available
              </>
            )}
          </div>
          <Button
            onClick={publish}
            loading={busy === "publishing"}
            disabled={targetCount === 0 || !entitled || busy !== "idle"}
          >
            {publishMode === "schedule" ? "Schedule" : "Publish now"}
          </Button>
        </div>

        {!entitled && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              You need {targetCount} upload token{targetCount === 1 ? "" : "s"} to publish to{" "}
              {targetCount} channel{targetCount === 1 ? "" : "s"}; you have {tokens}. Buy an
              upload bundle (4 tokens) or an access pass for unlimited publishing.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={buyBundle} loading={busy === "buying"}>
                Buy 4-token bundle
              </Button>
              <Link
                href={managementPaymentsPath(
                  managementContentPath(props.contentId)
                )}
              >
                <Button size="sm" variant="outline">
                  See access passes
                </Button>
              </Link>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>
    </div>
  );
}
