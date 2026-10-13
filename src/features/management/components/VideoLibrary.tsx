"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";
import {
  managementPaymentsPath,
  managementPublishReturnPath,
} from "@/config/routes";
import { UploadVideoButton } from "@/features/management/components/UploadVideoButton";
import { useI18n } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";
import {
  PublishFlowModal,
  type PublishFlowAsset,
  type PublishFlowConnection,
  type PublishFlowSuggestion,
  type PublishFlowUnavailableChannel,
  type PublishFlowVideo,
} from "@/features/management/components/PublishFlowModal";
import {
  formatHashtagText,
  parseHashtagText,
} from "@/lib/publishing/channelCopyPolicy";

/** How many videos to show per page in the library. */
const PAGE_SIZE = 5;

export interface LibraryChannel {
  platform: string;
  status: string;
  publishedUrl: string | null;
}

export interface LibraryVideo {
  id: string;
  title: string;
  description: string | null;
  defaultCaption: string | null;
  defaultHashtags: string[];
  sourceType: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  assets: PublishFlowAsset[];
  suggestions: PublishFlowSuggestion[];
  channels: LibraryChannel[];
  /** Estimated DigitalOcean Space purge date (ISO), or null when unknown. */
  spaceExpiry: string | null;
  usable: boolean;
}

interface VideoLibraryProps {
  videos: LibraryVideo[];
  /** Connected accounts from the channel-settings tab. */
  connections: PublishFlowConnection[];
  /** OAuth attempts that never completed — publishable to, they are not. */
  incompleteConnections?: number;
  /** Channels connected once but not publishable now (pending / disconnected). */
  unavailableChannels?: PublishFlowUnavailableChannel[];
  /** An active access pass — publishing does not spend tokens. */
  unlimited: boolean;
  /** Current one-channel publishing allowance when there is no access pass. */
  tokensRemaining: number;
  /** May the user upload their own video right now (has paid entitlement)? */
  canUpload: boolean;
  uploadMaxMB: number;
  /** e.g. "12 of 50 upload places left · each video kept 30 days". */
  quotaNote: string;
  /** Why the upload button is off: no package, or every place is taken. */
  uploadBlockedReason?: "package_required" | "full" | null;
}

/**
 * The user's video library ("วิดิโอของคุณ").
 *
 * Each card carries the thumbnail, a player, the date the video expires, the
 * channels it has gone out to, an inline editor for the title/default copy
 * (pre-filled into the composer at publish time), and a soft-delete. Uploading
 * your own video is gated on having paid — the button is disabled otherwise.
 */
export function VideoLibrary({
  videos,
  connections,
  incompleteConnections = 0,
  unavailableChannels = [],
  unlimited,
  tokensRemaining,
  canUpload,
  uploadMaxMB,
  quotaNote,
  uploadBlockedReason = null,
}: VideoLibraryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [list, setList] = useState(videos);
  const [page, setPage] = useState(1);
  const [tokens, setTokens] = useState(tokensRemaining);
  const [publishingVideo, setPublishingVideo] = useState<PublishFlowVideo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const resumedPublishingId = useRef<string | null>(null);
  const requestedPublishingId = searchParams.get("publish");
  const { t } = useI18n();
  // Videos that just came over from the studio (`?arrived=id,id`): announced,
  // highlighted, and the first one scrolled into view.
  const arrivedParam = searchParams.get("arrived") ?? "";
  const [arrived] = useState(() => new Set(arrivedParam.split(",").filter(Boolean)));
  const arrivalAnnounced = useRef(false);

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const shown = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (
      !requestedPublishingId ||
      resumedPublishingId.current === requestedPublishingId
    ) {
      return;
    }

    const itemIndex = list.findIndex((item) => item.id === requestedPublishingId);
    if (itemIndex < 0) return;

    resumedPublishingId.current = requestedPublishingId;
    setPage(Math.floor(itemIndex / PAGE_SIZE) + 1);
    setNotice(null);
    setPublishingVideo(toPublishFlowVideo(list[itemIndex]));
  }, [list, requestedPublishingId]);

  useEffect(() => {
    if (!requestedPublishingId) return;
    document
      .getElementById(`management-video-${requestedPublishingId}`)
      ?.scrollIntoView({ block: "center" });
  }, [requestedPublishingId, safePage]);

  useEffect(() => {
    if (arrivalAnnounced.current || arrived.size === 0) return;
    arrivalAnnounced.current = true;
    const firstIndex = list.findIndex((item) => arrived.has(item.id));
    if (firstIndex < 0) return;
    setPage(Math.floor(firstIndex / PAGE_SIZE) + 1);
    setNotice(t("mgmt.transfer.arrived", { count: arrived.size }));
    window.setTimeout(() => {
      document
        .getElementById(`management-video-${list[firstIndex].id}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
    // Drop the parameter so a reload does not announce the arrival again.
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("arrived");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [arrived, list, pathname, router, searchParams, t]);

  function closePublishingFlow() {
    setPublishingVideo(null);
    if (!searchParams.has("publish")) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("publish");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium text-emerald-900 hover:underline"
          >
            {t("common.dismiss")}
          </button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">{t("library.uploadOwn")}</p>
            <p className="text-xs text-slate-500">
              {t("library.maxPerFile", { max: uploadMaxMB })} · {quotaNote}
            </p>
          </div>
          {canUpload ? (
            <UploadVideoButton maxMB={uploadMaxMB} />
          ) : (
            <div className="text-right">
              <Button size="sm" disabled>
                {t("upload.button")}
              </Button>
              {uploadBlockedReason === "package_required" ? (
                <p className="mt-1 text-xs text-amber-700">
                  {t("library.uploadNeedsPackage")}{" "}
                  <Link href={ROUTES.PRICING} className="font-medium underline">
                    {t("studio.access.seePackages")}
                  </Link>
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-700">
                  {t("library.full")}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {list.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            {t("library.empty")}
          </p>
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((v) => (
              <VideoRow
                key={v.id}
                video={v}
                highlighted={arrived.has(v.id)}
                publishReady={unlimited || tokens > 0}
                onRemoved={() => setList((cur) => cur.filter((x) => x.id !== v.id))}
                onSaved={(updated) =>
                  setList((current) =>
                    current.map((item) =>
                      item.id === v.id ? { ...item, ...updated } : item
                    )
                  )
                }
                onPublish={(snapshot) => {
                  setNotice(null);
                  setPublishingVideo(snapshot);
                }}
              />
            ))}
          </ul>

          {/* Page selector — sits at the bottom of the list, above the footer. */}
          {pageCount > 1 && (
            <nav className="flex items-center justify-center gap-1 pt-4">
              <PageButton
                label="‹"
                disabled={safePage === 1}
                onClick={() => setPage(safePage - 1)}
              />
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <PageButton
                  key={n}
                  label={String(n)}
                  active={n === safePage}
                  onClick={() => setPage(n)}
                />
              ))}
              <PageButton
                label="›"
                disabled={safePage === pageCount}
                onClick={() => setPage(safePage + 1)}
              />
            </nav>
          )}
        </>
      )}

      {publishingVideo && (
        <PublishFlowModal
          video={publishingVideo}
          connections={connections}
          incompleteConnections={incompleteConnections}
          unavailableChannels={unavailableChannels}
          unlimited={unlimited}
          tokensRemaining={tokens}
          onClose={closePublishingFlow}
          onPublished={(channel) => {
            if (!unlimited) setTokens((current) => Math.max(0, current - 1));
            const channelLabel =
              connections.find((item) => item.platform === channel.platform)?.label ??
              channel.platform;
            setNotice(t("library.submittedTo", { channel: channelLabel }));
            setList((current) =>
              current.map((item) =>
                item.id === publishingVideo.id
                  ? { ...item, channels: [...item.channels, channel] }
                  : item
              )
            );
            // Refresh the server-rendered package summary so its remaining
            // upload count reflects the entitlement spend immediately.
            router.refresh();
          }}
          onDefaultsUpdated={(updated) => {
            setList((current) =>
              current.map((item) =>
                item.id === publishingVideo.id ? { ...item, ...updated } : item
              )
            );
            setPublishingVideo((current) =>
              current ? { ...current, ...updated } : current
            );
          }}
        />
      )}
    </div>
  );
}

/** Display name for a publishing channel (falls back to Capitalised slug). */
const LEGACY_TRAVY_VARIANT = ["tv", "ent"].join("");

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  [LEGACY_TRAVY_VARIANT]: "Travy",
  travy: "Travy",
};

function platformLabel(platform: string): string {
  const key = platform.toLowerCase();
  return PLATFORM_LABELS[key] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

function videoFormatMetadata(assets: PublishFlowAsset[]): string[] {
  return Array.from(
    new Set(
      assets.flatMap((asset) => {
        const variant = asset.variant.trim().toLowerCase();
        const isMultilingualExport =
          variant === "travy" || variant === LEGACY_TRAVY_VARIANT;
        const ratio =
          asset.aspectRatio?.trim() ||
          (/^\d+:\d+$/.test(variant) ? variant : isMultilingualExport ? "16:9" : null);

        if (!ratio) return [];
        return [
          isMultilingualExport
            ? `${ratio} · English + Chinese subtitles`
            : ratio,
        ];
      })
    )
  );
}

/** Colour + label for a per-channel publishing status. */
const STATUS_STYLES: Record<
  string,
  { label: MessageKey; badge: string; dot: string }
> = {
  published: { label: "posts.status.published", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  partially_published: { label: "library.status.partly", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  publishing: { label: "posts.status.publishing", badge: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500 animate-pulse" },
  scheduled: { label: "posts.status.scheduled", badge: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  failed: { label: "posts.status.failed", badge: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  draft: { label: "posts.status.draft", badge: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
};

function statusStyle(status: string, t: (key: MessageKey) => string) {
  const known = STATUS_STYLES[status.toLowerCase()];
  if (known) return { ...known, label: t(known.label) };
  return {
    label: status.charAt(0).toUpperCase() + status.slice(1),
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  };
}

/**
 * A professional per-channel publishing badge: a status dot, the channel name,
 * and a colour-coded status label (green published, blue publishing, amber
 * scheduled, red failed, grey draft).
 */
function ChannelStatusBadge({ platform, status }: { platform: string; status: string }) {
  const { t } = useI18n();
  const s = statusStyle(status, t);
  return (
    <span
      title={`${platformLabel(platform)} · ${s.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      <span>{platformLabel(platform)}</span>
      <span className="opacity-40">·</span>
      <span>{s.label}</span>
    </span>
  );
}

function PageButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-8 rounded-md border px-2.5 py-1 text-sm transition-colors ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

function VideoRow({
  video,
  highlighted = false,
  publishReady,
  onRemoved,
  onSaved,
  onPublish,
}: {
  video: LibraryVideo;
  /** Just arrived from the studio. */
  highlighted?: boolean;
  publishReady: boolean;
  onRemoved: () => void;
  onSaved: (
    updated: Pick<LibraryVideo, "title" | "defaultCaption" | "defaultHashtags">
  ) => void;
  onPublish: (video: PublishFlowVideo) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const formatMetadata = videoFormatMetadata(video.assets);
  const quotaTooltipId = useId();
  const [title, setTitle] = useState(video.title);
  const [caption, setCaption] = useState(video.defaultCaption ?? "");
  const [hashtags, setHashtags] = useState(
    formatHashtagText(video.defaultHashtags)
  );
  const [busy, setBusy] = useState<"idle" | "saving" | "deleting">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publishBlockedByQuota = !publishReady;
  const publishDisabled = !video.usable || publishBlockedByQuota;

  /**
   * One muted line of card metadata. This — not the editable title — is where
   * the aspect ratio belongs: it is a property of the stored file, not part of
   * the name the user publishes under.
   */
  const metaParts = [
    video.sourceType === "user_upload" ? t("library.uploaded") : t("library.transferred"),
    ...formatMetadata,
    video.spaceExpiry
      ? t(new Date(video.spaceExpiry).getTime() <= Date.now() ? "library.expired" : "library.expires", {
          date: new Date(video.spaceExpiry).toLocaleDateString(intlLocale(locale), {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })
      : t("library.noExpiry"),
  ];

  useEffect(() => {
    setTitle(video.title);
    setCaption(video.defaultCaption ?? "");
    setHashtags(formatHashtagText(video.defaultHashtags));
  }, [video.title, video.defaultCaption, video.defaultHashtags]);

  async function save() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError(t("library.titleRequired"));
      return;
    }

    setBusy("saving");
    setError(null);
    try {
      const normalizedHashtags = parseHashtagText(hashtags);
      const res = await fetch(`/api/management/content/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: normalizedTitle,
          defaultCaption: caption,
          defaultHashtags: normalizedHashtags,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved({
        title: normalizedTitle,
        defaultCaption: caption,
        defaultHashtags: normalizedHashtags,
      });
      setSavedAt(Date.now());
    } catch {
      setError(t("library.saveFailed"));
    } finally {
      setBusy("idle");
    }
  }

  async function remove() {
    if (!confirm(t("library.confirmRemove", { title: video.title }))) return;
    setBusy("deleting");
    setError(null);
    try {
      const res = await fetch(`/api/management/content/${video.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onRemoved();
      router.refresh();
    } catch {
      setError(t("library.removeFailed"));
      setBusy("idle");
    }
  }

  return (
    <li
      id={`management-video-${video.id}`}
      className={
        highlighted
          ? "scroll-mt-20 rounded-xl ring-2 ring-blue-500 ring-offset-2"
          : "scroll-mt-6"
      }
    >
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Media — the player, with a still preview image beneath it. */}
          <div className="w-full space-y-2 sm:w-64 sm:shrink-0">
            {video.usable && video.videoUrl && (
              <video
                controls
                preload="none"
                poster={video.thumbnailUrl ?? undefined}
                src={video.videoUrl}
                className="aspect-video w-full rounded-lg bg-black object-contain"
              />
            )}
            {/*
              The preview slot ALWAYS renders. It used to be suppressed whenever a
              playable video existed, which meant a missing thumbnail collapsed to
              empty space — indistinguishable from "this card has no preview by
              design", and the reason a broken poster pipeline went unnoticed.
            */}
            {video.thumbnailUrl ? (
              <figure className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  className="aspect-video w-full rounded-lg border border-slate-200 object-cover"
                />
                <figcaption className="text-center text-[11px] text-slate-400">{t("library.preview")}</figcaption>
              </figure>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                {video.usable ? t("library.noPreview") : t("library.mediaUnavailable")}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="min-w-0 flex-1 space-y-3">
            {/*
              Everything here is a full-width stack. The title input and the
              action buttons used to share one row, which on a phone squeezed the
              input down to a meaningless empty box and let the (wide, Thai)
              top-up button sit on top of its own label. Actions now live in a
              single wrapping bar at the foot of the card instead.
            */}
            <label className="block text-xs font-medium text-slate-600">
              {t("library.videoTitle")}
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setSavedAt(null);
                }}
                maxLength={200}
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>

            {/* Source, available formats and storage expiry on one muted line. */}
            <p className="text-xs leading-5 text-slate-500">{metaParts.join(" · ")}</p>

            {/* Publishing status per channel. */}
            {video.channels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {video.channels.map((c, i) => (
                  <ChannelStatusBadge key={i} platform={c.platform} status={c.status} />
                ))}
              </div>
            )}

            {/* Editable default caption / hashtags */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600">
                {t("library.defaultCaption")}
                <textarea
                  rows={2}
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    setSavedAt(null);
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder={t("library.captionPlaceholder")}
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                {t("posts.hashtagsLabel")}
                <input
                  value={hashtags}
                  onChange={(e) => {
                    setHashtags(e.target.value);
                    setSavedAt(null);
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="#restaurant #chiangmai #foodie"
                />
              </label>
            </div>

            {/* Action bar — wraps rather than overlaps on a narrow screen. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button size="sm" onClick={save} loading={busy === "saving"}>
                {t("common.save")}
              </Button>
              {savedAt && <span className="text-xs text-emerald-700">{t("common.saved")}</span>}
              {error && <span className="text-xs text-red-600">{error}</span>}

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {/*
                  The top-up link is only meaningful while publishing is actually
                  blocked. Rendering it unconditionally put a permanent, wide
                  button beside every video — including for users on an active
                  unlimited pass, who have nothing to top up.
                */}
                {publishBlockedByQuota && (
                  <Link
                    href={managementPaymentsPath(
                      managementPublishReturnPath(video.id)
                    )}
                  >
                    <Button size="sm" variant="secondary">
                      {t("library.topUp")}
                    </Button>
                  </Link>
                )}
                <span
                  className="group relative inline-flex"
                  tabIndex={publishBlockedByQuota ? 0 : undefined}
                >
                  <Button
                    size="sm"
                    variant={publishReady ? "success" : "outline"}
                    disabled={publishDisabled}
                    aria-describedby={
                      publishBlockedByQuota ? quotaTooltipId : undefined
                    }
                    title={
                      publishBlockedByQuota
                        ? undefined
                        : video.usable
                          ? t("library.publishHint")
                          : t("library.mediaUnavailable")
                    }
                    onClick={() =>
                      onPublish({
                        id: video.id,
                        title: title.trim(),
                        description: video.description,
                        defaultCaption: caption,
                        defaultHashtags: parseHashtagText(hashtags),
                        assets: video.assets,
                        suggestions: video.suggestions,
                      })
                    }
                  >
                    {t("library.publish")}
                  </Button>
                  {publishBlockedByQuota && (
                    <span
                      id={quotaTooltipId}
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover:block group-focus:block"
                    >
                      {t("library.topUpHint")}
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                    </span>
                  )}
                </span>
                <Button size="sm" variant="danger" onClick={remove} loading={busy === "deleting"}>
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </li>
  );
}

function toPublishFlowVideo(video: LibraryVideo): PublishFlowVideo {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    defaultCaption: video.defaultCaption,
    defaultHashtags: video.defaultHashtags,
    assets: video.assets,
    suggestions: video.suggestions,
  };
}
