"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";

/** One post = one channel destination of a publication. */
export interface ManagedPost {
  targetId: string;
  publicationId: string;
  platform: string;
  platformLabel: string;
  accountName: string | null;
  postName: string;
  thumbnailUrl: string | null;
  dateIso: string | null;
  status: string;
  publishedUrl: string | null;
  /** True only for a still-scheduled post — the only state the API can change. */
  canManage: boolean;
  caption: string;
  title: string | null;
  description: string | null;
  hashtags: string[];
}

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-blue-100 text-blue-800",
  publishing: "bg-amber-100 text-amber-800",
  draft: "bg-slate-100 text-slate-600",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS: Record<string, MessageKey> = {
  published: "posts.status.published",
  scheduled: "posts.status.scheduled",
  publishing: "posts.status.publishing",
  draft: "posts.status.draft",
  failed: "posts.status.failed",
  cancelled: "posts.status.cancelled",
};

function formatDate(iso: string | null, dateTag = "en-GB"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(dateTag, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * The manage-posts list ("จัดการโพสต์").
 *
 * Every post is shown with its thumbnail, channel, name, date and status. A
 * published post links out to the live post but has no edit/delete — those only
 * appear on a scheduled post, which the provider can still change or cancel.
 */
export function PostsManager({ posts }: { posts: ManagedPost[] }) {
  const { t } = useI18n();
  const [list, setList] = useState(posts);

  if (list.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          {t("posts.empty")}
        </p>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {list.map((post) => (
        <PostRow
          key={post.targetId}
          post={post}
          onRemoved={() =>
            setList((cur) => cur.filter((p) => p.targetId !== post.targetId))
          }
          onSaved={(updated) =>
            setList((cur) =>
              cur.map((p) =>
                p.targetId === post.targetId ? { ...p, ...updated } : p
              )
            )
          }
        />
      ))}
    </ul>
  );
}

function PostRow({
  post,
  onRemoved,
  onSaved,
}: {
  post: ManagedPost;
  onRemoved: () => void;
  onSaved: (
    updated: Pick<ManagedPost, "caption" | "title" | "hashtags">
  ) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [title, setTitle] = useState(post.title ?? "");
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [busy, setBusy] = useState<"idle" | "saving" | "deleting">("idle");
  const [error, setError] = useState<string | null>(null);

  function parseHashtags(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((h) => h.replace(/^#/, "").trim())
      .filter(Boolean);
  }

  async function save() {
    setBusy("saving");
    setError(null);
    try {
      const res = await fetch(
        `/api/management/publications/${post.publicationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId: post.targetId,
            caption,
            title: title.trim() ? title.trim() : null,
            hashtags: parseHashtags(hashtags),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t("posts.saveFailed"));
      }
      onSaved({
        caption,
        title: title.trim() ? title.trim() : null,
        hashtags: parseHashtags(hashtags),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("posts.saveFailed"));
    } finally {
      setBusy("idle");
    }
  }

  async function remove() {
    if (!confirm(t("posts.confirmCancel", { channel: post.platformLabel }))) return;
    setBusy("deleting");
    setError(null);
    try {
      const res = await fetch(
        `/api/management/publications/${post.publicationId}?targetId=${encodeURIComponent(post.targetId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t("posts.deleteFailed"));
      }
      onRemoved();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("posts.deleteFailed"));
      setBusy("idle");
    }
  }

  return (
    <li>
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Thumbnail */}
          <div className="w-full sm:w-40 sm:shrink-0">
            {post.thumbnailUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={post.thumbnailUrl}
                alt={post.postName}
                className="aspect-video w-full rounded-lg object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
                {t("posts.noThumbnail")}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {post.postName}
                </p>
                <p className="text-xs text-slate-500">
                  {post.platformLabel}
                  {post.accountName ? ` · ${post.accountName}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatDate(post.dateIso, intlLocale(locale))}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  STATUS_STYLES[post.status] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {STATUS_LABELS[post.status] ? t(STATUS_LABELS[post.status]) : post.status}
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {post.publishedUrl && (
                <a
                  href={post.publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  {t("posts.view")}
                </a>
              )}

              {post.canManage ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing((v) => !v)}
                  >
                    {editing ? t("common.close") : t("common.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={remove}
                    loading={busy === "deleting"}
                  >
                    {t("common.delete")}
                  </Button>
                </>
              ) : (
                <span className="text-xs text-slate-400">
                  {t("posts.cannotManage")}
                </span>
              )}
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            {/* Inline editor — scheduled posts only */}
            {editing && post.canManage && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="block text-xs font-medium text-slate-600">
                  {t("posts.caption")}
                  <textarea
                    rows={2}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder={t("posts.captionPlaceholder")}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  {t("posts.titleYoutube")}
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder={t("posts.titlePlaceholder")}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  {t("posts.hashtagsLabel")}
                  <input
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="restaurant chiangmai foodie"
                  />
                </label>
                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={save} loading={busy === "saving"}>
                    {t("posts.save")}
                  </Button>
                  <span className="text-xs text-slate-400">
                    {t("posts.saveHint")}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}
