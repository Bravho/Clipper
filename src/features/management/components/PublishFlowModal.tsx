"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  managementPaymentsPath,
  managementPublishReturnPath,
  ROUTES,
} from "@/config/routes";
import {
  connectionMatchesSuggestedPlatform,
  defaultVariantForPlatform,
  isAspectRatioCompatibleWithPlatform,
} from "@/config/managementPublishing";
import {
  CHANNEL_COPY_POLICIES,
  parseHashtagText,
  resolvePublishingCopyDefaults,
  validateChannelCopy,
} from "@/lib/publishing/channelCopyPolicy";

export interface PublishFlowAsset {
  id: string;
  variant: string;
  aspectRatio: string | null;
}

export interface PublishFlowConnection {
  id: string;
  platform: string;
  label: string;
  accountName: string | null;
}

export interface PublishFlowVideo {
  id: string;
  title: string;
  description: string | null;
  defaultCaption: string | null;
  defaultHashtags: string[];
  assets: PublishFlowAsset[];
  suggestions: PublishFlowSuggestion[];
}

export interface PublishFlowSuggestion {
  platform: string;
  displayOrder: number;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  locale: string | null;
}

interface UpdatedContentDefaults {
  title: string;
  description: string | null;
  defaultCaption: string | null;
  defaultHashtags: string[];
}

interface PublishedChannel {
  platform: string;
  status: string;
  publishedUrl: string | null;
}

interface PublishFlowModalProps {
  video: PublishFlowVideo;
  connections: PublishFlowConnection[];
  /**
   * Connection attempts stuck at `pending`. They are deliberately NOT offered
   * as publish targets — we have no provider account id to post through — but
   * the empty state must acknowledge them, or a user who just authorised four
   * accounts is told they have none.
   */
  incompleteConnections?: number;
  unlimited: boolean;
  tokensRemaining: number;
  onClose: () => void;
  onPublished: (channel: PublishedChannel) => void;
  onDefaultsUpdated: (updated: UpdatedContentDefaults) => void;
}

type Phase = "channels" | "form" | "confirm" | "update" | "complete";
type Busy = "idle" | "publishing" | "updating";

const VIDEO_LIBRARY_LABEL = "\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e02\u0e2d\u0e07\u0e04\u0e38\u0e13";
const LEGACY_TRAVY_VARIANT = ["tv", "ent"].join("");

function videoVariantLabel(variant: string): string {
  const normalized = variant.trim().toLowerCase();
  if (normalized === "travy" || normalized === LEGACY_TRAVY_VARIANT) {
    return "Travy";
  }
  return variant;
}

interface FormState {
  assetId: string;
  title: string;
  caption: string;
  hashtags: string;
  publishMode: "now" | "schedule";
  scheduledAtLocal: string;
}

interface FormConfig {
  titleLabel: string;
  captionLabel: string;
  captionPlaceholder: string;
  hasTitle: boolean;
}

type PublishResponse = {
  publication?: { id: string; status: string };
  targets?: Array<{
    platform: string;
    status: string;
    errorCode: string | null;
    publishedUrl: string | null;
  }>;
  error?: string;
};

/**
 * The direct-from-library publishing flow:
 * channel picker -> channel form -> submission confirmation -> save-back prompt.
 *
 * Each submission intentionally targets one connected account. This mirrors the
 * user's mental model when pressing Publish on one video, makes platform-specific
 * validation understandable, and keeps the post-submit "use these values as the
 * video's defaults" decision unambiguous.
 */
export function PublishFlowModal({
  video,
  connections,
  incompleteConnections = 0,
  unlimited,
  tokensRemaining,
  onClose,
  onPublished,
  onDefaultsUpdated,
}: PublishFlowModalProps) {
  const [phase, setPhase] = useState<Phase>("channels");
  const [connection, setConnection] = useState<PublishFlowConnection | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [submittedStatus, setSubmittedStatus] = useState<string | null>(null);
  const [defaultsUpdated, setDefaultsUpdated] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy !== "idle") return;
      if (phase === "confirm") {
        setPhase("form");
      } else if (phase === "form") {
        setPhase("channels");
        setConnection(null);
        setForm(null);
      } else if (phase === "update") {
        onClose();
      } else {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose, phase]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [phase]);

  const compatibleAssets = useMemo(() => {
    if (!connection) return [];
    return video.assets.filter((asset) =>
      isAspectRatioCompatibleWithPlatform(connection.platform, asset.aspectRatio)
    );
  }, [connection, video.assets]);

  const orderedConnections = useMemo(() => {
    const suggestionRank = (platform: string) => {
      const suggestion = video.suggestions.find((candidate) =>
        connectionMatchesSuggestedPlatform(platform, candidate.platform)
      );
      return suggestion?.displayOrder ?? Number.MAX_SAFE_INTEGER;
    };
    return connections
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          suggestionRank(a.item.platform) - suggestionRank(b.item.platform) ||
          a.index - b.index
      )
      .map(({ item }) => item);
  }, [connections, video.suggestions]);

  function suggestionFor(platform: string): PublishFlowSuggestion | null {
    return (
      video.suggestions.find((candidate) =>
        connectionMatchesSuggestedPlatform(platform, candidate.platform)
      ) ?? null
    );
  }

  const config = channelFormConfig(connection?.platform ?? "");
  const titleLabel = config.hasTitle ? config.titleLabel : "Video title";
  const titleMaximum = Math.min(
    CHANNEL_COPY_POLICIES[connection?.platform ?? ""]?.titleMaximum ?? 200,
    200
  );
  const hashtags = parseHashtagText(form?.hashtags ?? "");
  const copyValidation =
    connection && form
      ? validateChannelCopy(connection.platform, {
          title: form.title,
          caption: form.caption,
          hashtags,
        })
      : null;

  function chooseChannel(nextConnection: PublishFlowConnection) {
    const assets = video.assets.filter((asset) =>
      isAspectRatioCompatibleWithPlatform(nextConnection.platform, asset.aspectRatio)
    );
    const preferredRatio = defaultVariantForPlatform(nextConnection.platform);
    const preferredAsset =
      assets.find((asset) => asset.aspectRatio === preferredRatio) ?? assets[0] ?? null;
    const nextConfig = channelFormConfig(nextConnection.platform);
    const suggestion = suggestionFor(nextConnection.platform);
    const copiedDefaults = resolvePublishingCopyDefaults({
      defaultCaption: video.defaultCaption,
      defaultHashtags: video.defaultHashtags,
      fallbackCaption: suggestion?.caption || video.description,
      fallbackHashtags: suggestion?.hashtags,
    });

    setConnection(nextConnection);
    setForm({
      assetId: preferredAsset?.id ?? "",
      title: nextConfig.hasTitle ? suggestion?.title || video.title : video.title,
      caption: copiedDefaults.caption,
      hashtags: copiedDefaults.hashtags
        .map((tag) => `#${tag.replace(/^#/, "")}`)
        .join(" "),
      publishMode: "now",
      scheduledAtLocal: "",
    });
    setError(null);
    setPhase("form");
  }

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function validateForm(): string | null {
    if (!connection || !form) return "Choose a connected channel.";
    if (!form.assetId) return `No compatible video format is available for ${connection.label}.`;
    if (!form.title.trim()) return `${titleLabel} is required.`;
    if (!form.caption.trim()) return `${config.captionLabel} is required.`;
    if (hashtags.length > 60) return "Use no more than 60 hashtags.";
    if (hashtags.some((hashtag) => hashtag.length > 100)) {
      return "Each hashtag must be 100 characters or fewer.";
    }
    if (copyValidation && !copyValidation.valid) {
      return copyLimitMessage(connection.platform, copyValidation, hashtags.length);
    }
    if (form.publishMode === "schedule") {
      if (!form.scheduledAtLocal) return "Choose a date and time.";
      const scheduled = new Date(form.scheduledAtLocal);
      if (
        Number.isNaN(scheduled.getTime()) ||
        scheduled.getTime() < Date.now() + 60_000
      ) {
        return "The scheduled time must be at least one minute in the future.";
      }
    }
    return null;
  }

  function reviewSubmission() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setPhase("confirm");
  }

  async function submitPublication() {
    if (!connection || !form) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setPhase("form");
      return;
    }

    setBusy("publishing");
    setError(null);
    const scheduledAt =
      form.publishMode === "schedule"
        ? new Date(form.scheduledAtLocal).toISOString()
        : null;

    try {
      const response = await fetch("/api/management/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId: video.id,
          publishMode: form.publishMode === "schedule" ? "scheduled" : "publish_now",
          scheduledAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          targets: [
            {
              socialConnectionId: connection.id,
              managementContentAssetId: form.assetId,
              caption: form.caption.trim(),
              title: config.hasTitle ? form.title.trim() : null,
              description:
                connection.platform === "youtube" ? form.caption.trim() : null,
              hashtags,
            },
          ],
        }),
      });
      const data = (await response.json().catch(() => ({}))) as PublishResponse;

      if (response.status === 402) {
        setError("Publishing access is required. Add publish tokens or activate a plan.");
        setPhase("form");
        return;
      }
      if (!response.ok || !data.publication) {
        setError(data.error ?? "The post could not be submitted. Please try again.");
        setPhase("form");
        return;
      }

      const target = data.targets?.[0];
      const status = target?.status ?? data.publication.status;
      setSubmittedStatus(status);
      onPublished({
        platform: target?.platform ?? connection.platform,
        status,
        publishedUrl: target?.publishedUrl ?? null,
      });
      setPhase("update");
    } catch {
      setError("The post could not be submitted. Please check your connection and try again.");
      setPhase("form");
    } finally {
      setBusy("idle");
    }
  }

  async function updateVideoDefaults() {
    if (!connection || !form) return;

    setBusy("updating");
    setError(null);
    const patch = {
      title: form.title.trim(),
      ...(connection.platform === "youtube"
        ? { description: form.caption.trim() }
        : {}),
      defaultCaption: form.caption.trim(),
      defaultHashtags: hashtags,
    };

    try {
      const response = await fetch(`/api/management/content/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "The post was submitted, but the video defaults were not updated.");
        return;
      }
      onDefaultsUpdated({
        title: data.title,
        description: data.description,
        defaultCaption: data.defaultCaption,
        defaultHashtags: data.defaultHashtags,
      });
      setDefaultsUpdated(true);
      setPhase("complete");
    } catch {
      setError("The post was submitted, but the video defaults were not updated.");
    } finally {
      setBusy("idle");
    }
  }

  function keepExistingDefaults() {
    setDefaultsUpdated(false);
    setError(null);
    setPhase("complete");
  }

  const canPublish = unlimited || tokensRemaining > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-flow-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              {phaseLabel(phase)}
            </p>
            <h2 id="publish-flow-title" className="mt-0.5 text-lg font-semibold text-slate-950">
              {phaseTitle(phase, connection)}
            </h2>
            {phase !== "complete" && (
              <p className="mt-1 line-clamp-1 text-sm text-slate-500">
                {form?.title.trim() || video.title}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close publishing window"
            disabled={busy !== "idle"}
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <CloseIcon />
          </button>
        </div>

        {phase === "channels" && (
          <div className="app-safe-bottom px-5 pt-5 sm:px-6 sm:pt-6">
            <p className="text-sm leading-6 text-slate-600">
              Suggested channels from video generation appear first. You may still
              choose any compatible connected account.
            </p>
            {connections.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {orderedConnections.map((item) => {
                  const suggested = !!suggestionFor(item.platform);
                  return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseChannel(item)}
                    className="group flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <ChannelMark platform={item.platform} label={item.label} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-950">
                        {item.label}
                        {suggested && (
                          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                            Suggested
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {item.accountName || "Connected account"}
                      </span>
                    </span>
                    <ChevronRightIcon />
                  </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <p className="text-sm font-medium text-slate-800">
                  {incompleteConnections > 0
                    ? `${incompleteConnections} connection${
                        incompleteConnections === 1 ? "" : "s"
                      } not finished`
                    : "No connected channels yet"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {incompleteConnections > 0
                    ? "Those accounts have not been confirmed by the publishing provider yet, so we cannot post through them. Open channel settings and press Refresh on each one."
                    : "Connect an account first, then return here to publish this video."}
                </p>
                <Link href={ROUTES.MANAGEMENT_CONNECTIONS} className="mt-3 inline-block">
                  <Button size="sm">Open channel settings</Button>
                </Link>
              </div>
            )}
            <AccessNote unlimited={unlimited} tokensRemaining={tokensRemaining} />
          </div>
        )}

        {phase === "form" && connection && form && (
          <>
            <div className="space-y-5 p-5 sm:p-6">
              <SelectedChannel connection={connection} />

              {compatibleAssets.length === 0 ? (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900">
                    No compatible video format is available for {connection.label}.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    Choose another channel or add a video in a supported aspect ratio.
                  </p>
                </div>
              ) : (
                <label className="block">
                  <span className="text-sm font-medium text-slate-800">Video format</span>
                  <select
                    value={form.assetId}
                    onChange={(event) => patchForm({ assetId: event.target.value })}
                    className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {compatibleAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {videoVariantLabel(asset.variant)}
                        {asset.aspectRatio ? ` (${asset.aspectRatio})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="text-sm font-medium text-slate-800">
                  {titleLabel} *
                </span>
                <input
                  value={form.title}
                  onChange={(event) => patchForm({ title: event.target.value })}
                  maxLength={titleMaximum}
                  required
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <FieldCount value={form.title.length} maximum={titleMaximum} />
                {!config.hasTitle && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    This title identifies the item in {VIDEO_LIBRARY_LABEL}. {connection.label}{" "}
                    uses the caption as its public post text.
                  </p>
                )}
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-800">
                  {config.captionLabel} *
                </span>
                <textarea
                  rows={5}
                  value={form.caption}
                  onChange={(event) => patchForm({ caption: event.target.value })}
                  maxLength={CHANNEL_COPY_POLICIES[connection.platform]?.captionMaximum ?? 5000}
                  required
                  placeholder={config.captionPlaceholder}
                  className="mt-1.5 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <FieldCount
                  value={form.caption.length}
                  maximum={CHANNEL_COPY_POLICIES[connection.platform]?.captionMaximum}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-800">Hashtags</span>
                <input
                  value={form.hashtags}
                  onChange={(event) => patchForm({ hashtags: event.target.value })}
                  placeholder="#restaurant #chiangmai #foodie"
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Separate hashtags with spaces or commas
                  {CHANNEL_COPY_POLICIES[connection.platform]?.maximumHashtags
                    ? ` · up to ${CHANNEL_COPY_POLICIES[connection.platform]?.maximumHashtags}`
                    : ""}
                </p>
              </label>

              <fieldset>
                <legend className="text-sm font-medium text-slate-800">Publish timing</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  <TimingButton
                    active={form.publishMode === "now"}
                    onClick={() => patchForm({ publishMode: "now" })}
                  >
                    Publish now
                  </TimingButton>
                </div>
              </fieldset>

              {error && <ErrorNotice message={error} />}

              {!canPublish && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900">
                    You need one publish token or an active plan to submit this post.
                  </p>
                  <Link
                    href={managementPaymentsPath(
                      managementPublishReturnPath(video.id)
                    )}
                    className="mt-3 inline-block"
                  >
                    <Button size="sm">Add publishing access</Button>
                  </Link>
                </div>
              )}
            </div>
            <ModalFooter align="between">
              <Button
                variant="ghost"
                onClick={() => {
                  setPhase("channels");
                  setConnection(null);
                  setForm(null);
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button
                onClick={reviewSubmission}
                disabled={!canPublish || compatibleAssets.length === 0}
              >
                Review submission
              </Button>
            </ModalFooter>
          </>
        )}

        {phase === "confirm" && connection && form && (
          <>
            <div className="px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <SummaryRow label="Channel" value={`${connection.label}${connection.accountName ? ` · ${connection.accountName}` : ""}`} />
                <SummaryRow
                  label="Timing"
                  value={
                    form.publishMode === "schedule"
                      ? new Date(form.scheduledAtLocal).toLocaleString()
                      : "Publish now"
                  }
                />
                <SummaryRow
                  label={config.hasTitle ? config.titleLabel : "Video title (video library)"}
                  value={form.title}
                />
                <SummaryRow label={config.captionLabel} value={form.caption} multiline />
                {hashtags.length > 0 && (
                  <SummaryRow
                    label="Hashtags"
                    value={hashtags.map((tag) => `#${tag}`).join(" ")}
                    multiline
                  />
                )}
              </div>
              <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-950">
                  Confirm this posting submission?
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-800">
                  RClipper will send this video and the information above to the selected
                  connected channel.
                </p>
              </div>
              {error && <div className="mt-4"><ErrorNotice message={error} /></div>}
            </div>
            <ModalFooter align="end">
              <Button variant="outline" onClick={() => setPhase("form")} disabled={busy !== "idle"}>
                Edit form
              </Button>
              <Button onClick={submitPublication} loading={busy === "publishing"}>
                Confirm and submit
              </Button>
            </ModalFooter>
          </>
        )}

        {phase === "update" && connection && form && (
          <>
            <div className="px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <SuccessIcon />
                <div>
                  <p className="text-sm font-semibold text-emerald-950">
                    Post submitted to {connection.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">
                    Current status: {humanizeStatus(submittedStatus)}. Your submission is
                    already confirmed.
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <h3 className="text-base font-semibold text-slate-950">
                  Save these edited details to the original video?
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This optional step only updates the item in{" "}
                  <strong className="font-semibold text-slate-800">
                    {VIDEO_LIBRARY_LABEL}
                  </strong>
                  . It will not change the {connection.label} post you just submitted.
                </p>
              </div>

              <div className="mt-4 grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
                <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Edited details for {connection.label}
                  </p>
                  {form.title.trim() && (
                    <p className="mt-2 truncate text-sm font-semibold text-slate-900">
                      {form.title.trim()}
                    </p>
                  )}
                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-700">
                    {form.caption.trim()}
                  </p>
                  {hashtags.length > 0 && (
                    <p className="mt-2 line-clamp-1 text-xs text-blue-700">
                      {hashtags.map((tag) => `#${tag}`).join(" ")}
                    </p>
                  )}
                </div>

                <div
                  aria-hidden="true"
                  className="flex items-center justify-center text-lg font-medium text-slate-400 sm:px-0"
                >
                  <span className="sm:hidden">&darr;</span>
                  <span className="hidden sm:inline">&rarr;</span>
                </div>

                <div className="min-w-0 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                    Save as default text in
                  </p>
                  <p className="mt-2 text-sm font-semibold text-blue-950">
                    {VIDEO_LIBRARY_LABEL}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-blue-900/80">
                    {form.title.trim()}
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500">
                Saving will replace{" "}
                {connection.platform === "youtube"
                  ? "this video's saved title, description, caption, and hashtags"
                  : "this video's saved title, caption, and hashtags"}
                . The submitted text will be pre-filled the next time you publish this
                video.
              </p>

              {error && <div className="mt-4"><ErrorNotice message={error} /></div>}
            </div>
            <ModalFooter align="end">
              <Button
                variant="outline"
                onClick={keepExistingDefaults}
                disabled={busy !== "idle"}
              >
                Keep existing text
              </Button>
              <Button onClick={updateVideoDefaults} loading={busy === "updating"}>
                Save edited details
              </Button>
            </ModalFooter>
          </>
        )}

        {phase === "complete" && connection && (
          <>
            <div className="px-6 pb-6 pt-6 text-center sm:px-8 sm:pt-8">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <SuccessIcon large />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">All done</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                Your {connection.label} post was submitted
                {defaultsUpdated
                  ? `, and its text is now saved to the original video in ${VIDEO_LIBRARY_LABEL}.`
                  : `. The original video's saved text in ${VIDEO_LIBRARY_LABEL} was left unchanged.`}
              </p>
            </div>
            <ModalFooter align="center">
              <Button onClick={onClose}>Done</Button>
            </ModalFooter>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * The action bar for one step of the flow.
 *
 * Pinned to the bottom of the scrolling dialog and padded past the device's
 * bottom inset (`app-safe-bottom`). The dialog is a `position: fixed` bottom
 * sheet on phones, so it sits outside `body`'s safe-area padding: without this
 * the primary button of each step ends up underneath the Android
 * three-button navigation bar / iOS home indicator.
 */
function ModalFooter({
  children,
  align,
}: {
  children: ReactNode;
  align: "between" | "end" | "center";
}) {
  const justify =
    align === "between"
      ? "justify-between"
      : align === "center"
        ? "justify-center"
        : "justify-end";
  return (
    <div
      className={`app-safe-bottom sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white px-5 pt-4 sm:gap-3 sm:px-6 ${justify}`}
    >
      {children}
    </div>
  );
}

function channelFormConfig(platform: string): FormConfig {
  if (platform === "youtube") {
    return {
      titleLabel: "Video title",
      captionLabel: "Description",
      captionPlaceholder: "Describe the video for YouTube",
      hasTitle: true,
    };
  }
  if (platform === "pinterest") {
    return {
      titleLabel: "Pin title",
      captionLabel: "Description",
      captionPlaceholder: "Describe this video pin",
      hasTitle: true,
    };
  }
  return {
    titleLabel: "Title",
    captionLabel: "Caption",
    captionPlaceholder: `Write a caption for ${platform || "this channel"}`,
    hasTitle: false,
  };
}

function copyLimitMessage(
  platform: string,
  validation: NonNullable<ReturnType<typeof validateChannelCopy>>,
  hashtagCount: number
): string {
  const policy = CHANNEL_COPY_POLICIES[platform] ?? {};
  if (policy.combinedMaximum && validation.combinedLength > policy.combinedMaximum) {
    return `Caption and hashtags must be ${policy.combinedMaximum} characters or fewer for this channel.`;
  }
  if (policy.titleMaximum && validation.titleLength > policy.titleMaximum) {
    return `The title must be ${policy.titleMaximum} characters or fewer for this channel.`;
  }
  if (policy.captionMaximum && validation.captionLength > policy.captionMaximum) {
    return `${channelFormConfig(platform).captionLabel} must be ${policy.captionMaximum} characters or fewer for this channel.`;
  }
  if (policy.maximumHashtags && hashtagCount > policy.maximumHashtags) {
    return `Use no more than ${policy.maximumHashtags} hashtags for this channel.`;
  }
  return "One or more fields exceed this channel's publishing limits.";
}

function phaseLabel(phase: Phase): string {
  if (phase === "channels") return "Step 1 of 3";
  if (phase === "form") return "Step 2 of 3";
  if (phase === "confirm") return "Step 3 of 3";
  if (phase === "update") return "Post submitted · Optional next step";
  return "Complete";
}

function phaseTitle(
  phase: Phase,
  connection: PublishFlowConnection | null
): string {
  if (phase === "channels") return "Choose a connected channel";
  if (phase === "form") return `Prepare ${connection?.label ?? "channel"} post`;
  if (phase === "confirm") return "Confirm posting submission";
  if (phase === "update") return "Save edited details to this video?";
  return "Publishing submission complete";
}

function humanizeStatus(status: string | null): string {
  if (!status) return "submitted";
  return status.replace(/_/g, " ");
}

function AccessNote({
  unlimited,
  tokensRemaining,
}: {
  unlimited: boolean;
  tokensRemaining: number;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
      <span>One submission publishes to one connected channel.</span>
      <span className="shrink-0 font-semibold text-slate-800">
        {unlimited ? "Unlimited plan" : `${tokensRemaining} token${tokensRemaining === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

function SelectedChannel({ connection }: { connection: PublishFlowConnection }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
      <ChannelMark platform={connection.platform} label={connection.label} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-950">{connection.label}</p>
        <p className="truncate text-xs text-slate-600">
          {connection.accountName || "Connected account"}
        </p>
      </div>
    </div>
  );
}

function ChannelMark({ platform, label }: { platform: string; label: string }) {
  const styles: Record<string, string> = {
    facebook: "bg-[#1877F2] text-white",
    instagram: "bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 text-white",
    youtube: "bg-[#FF0033] text-white",
    tiktok: "bg-slate-950 text-white",
    tiktok_business: "bg-slate-950 text-white",
    x: "bg-black text-white",
    linkedin: "bg-[#0A66C2] text-white",
    pinterest: "bg-[#E60023] text-white",
    threads: "bg-black text-white",
    bluesky: "bg-[#1185FE] text-white",
  };
  return (
    <span
      aria-hidden="true"
      className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl text-xs font-bold shadow-sm ${styles[platform] ?? "bg-slate-800 text-white"}`}
    >
      {platform === "youtube"
        ? "▶"
        : platform.startsWith("tiktok")
          ? "♪"
          : label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function TimingButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-blue-600 bg-blue-50 text-blue-800"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function FieldCount({ value, maximum }: { value: number; maximum?: number }) {
  if (!maximum) return null;
  return (
    <p className="mt-1 text-right text-xs text-slate-400">
      {value}/{maximum}
    </p>
  );
}

function SummaryRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="border-b border-slate-200 py-3 first:pt-0 last:border-0 last:pb-0 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-800 sm:mt-0 ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {message}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-slate-400" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SuccessIcon({ large = false }: { large?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${large ? "h-6 w-6" : "mt-0.5 h-5 w-5"} flex-none text-emerald-700`}
      fill="none"
      aria-hidden="true"
    >
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
