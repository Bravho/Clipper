"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";
import type {
  CreatorCampaignStatus,
  PublicCampaignView,
  RewardClaimResult,
} from "@/services/campaigns/CampaignCreatorService";
import {
  CampaignApiError,
  addCampaignPost,
  claimCampaignReward,
  fetchCampaignManifest,
  reportVideoMade,
  startCampaignSession,
} from "@/features/campaigns/campaignClient";
import {
  canMakeCampaignVideo,
  renderCampaignVideo,
  saveCampaignVideo,
  shareCampaignVideo,
} from "@/features/campaigns/campaignRender";
import { finishedVideoUri } from "@/lib/mobile/finishedVideoCache";

/**
 * The Merchant Quick Video: Scan → Shoot → Create → Share. No login.
 *
 * Deliberately NOT the studio: there is no brief, storyboard, voice, template
 * or ratio to choose. The shop's campaign decides the look, the opening card
 * (name, location), the closing card (friend discount + this creator's code)
 * and the default sound; the customer records one clip, may edit one sentence
 * and may pick another sound. The phone renders it with the same renderer the
 * studio uses, and the video never leaves the phone unless they share it.
 */

const CLIP_SOUND = "clip_sound";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" }
  | { kind: "rendering"; percent: number | null }
  | { kind: "done"; videoKey: string; videoSrc: string | null; soundFallback: boolean };

interface PickedClip {
  file: File;
  url: string;
  seconds: number;
}

function errorKey(code: string): MessageKey {
  switch (code) {
    case "bad_key":
      return "campaign.error.bad_key";
    case "ended":
      return "campaign.error.ended";
    case "not_live":
      return "campaign.error.not_live";
    case "not_found":
      return "campaign.error.not_found";
    case "bad_install":
      return "campaign.error.update";
    default:
      return "campaign.error.generic";
  }
}

function readDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = () => {
      const seconds = video.duration;
      video.removeAttribute("src");
      video.load();
      if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(new Error("unknown duration"));
    };
    video.onloadedmetadata = done;
    video.onerror = () => reject(new Error("unreadable"));
    video.src = url;
    setTimeout(() => reject(new Error("timeout")), 15_000);
  });
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/:*?<>|]+/g, "").trim().slice(0, 80);
  return `${cleaned || "RClipper"} - RClipper.mp4`;
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "th" ? "th-TH" : locale === "vi" ? "vi-VN" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function CampaignQuickVideo({ slug, qrKey }: { slug: string; qrKey: string }) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [campaign, setCampaign] = useState<PublicCampaignView | null>(null);
  const [status, setStatus] = useState<CreatorCampaignStatus | null>(null);
  const [clip, setClip] = useState<PickedClip | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [sound, setSound] = useState(CLIP_SOUND);
  const [notice, setNotice] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [postSaved, setPostSaved] = useState(false);
  const [claim, setClaim] = useState<RewardClaimResult | null>(null);
  const [busy, setBusy] = useState<"share" | "save" | "post" | "claim" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  // Open the campaign: session (creator + code) in one call.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Capacitor.isNativePlatform() && !(await canMakeCampaignVideo())) {
          if (!cancelled) setPhase({ kind: "error", message: t("campaign.error.update") });
          return;
        }
        const result = await startCampaignSession(slug, qrKey);
        if (cancelled) return;
        setCampaign(result.campaign);
        setStatus(result.status);
        setStatement(result.campaign.defaultStatement);
        setSound(result.campaign.defaultSound || CLIP_SOUND);
        setPhase({ kind: "ready" });
      } catch (error) {
        if (cancelled) return;
        const code = error instanceof CampaignApiError ? error.code : "server_error";
        setPhase({ kind: "error", message: t(errorKey(code)) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, qrKey, t]);

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url);
  }, [clip]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file || !campaign) return;
      setClipError(null);
      const url = URL.createObjectURL(file);
      try {
        const seconds = await readDuration(url);
        if (seconds < campaign.limits.minClipSeconds) {
          URL.revokeObjectURL(url);
          setClip(null);
          setClipError(t("campaign.shoot.tooShort", { seconds: campaign.limits.minClipSeconds }));
          return;
        }
        setClip({ file, url, seconds });
      } catch {
        URL.revokeObjectURL(url);
        setClip(null);
        setClipError(t("campaign.shoot.unreadable"));
      }
    },
    [campaign, t]
  );

  const togglePreview = useCallback(
    (id: string, url: string) => {
      if (playing === id) {
        audioRef.current?.pause();
        setPlaying(null);
        return;
      }
      audioRef.current?.pause();
      const audio = new Audio(url);
      audio.onended = () => setPlaying(null);
      audioRef.current = audio;
      void audio.play().catch(() => setPlaying(null));
      setPlaying(id);
    },
    [playing]
  );

  const create = useCallback(async () => {
    if (!clip || !campaign) return;
    audioRef.current?.pause();
    setPlaying(null);
    setNotice(null);
    setPhase({ kind: "rendering", percent: null });
    try {
      const plan = await fetchCampaignManifest(slug, qrKey, {
        localId: "campaign-clip",
        mimeType: clip.file.type || "video/mp4",
        durationSeconds: clip.seconds,
        statement,
        sound,
      });
      const videoKey = `campaign-${slug}-${Date.now()}`;
      const result = await renderCampaignVideo({
        manifest: plan.manifest,
        file: clip.file,
        useClipSound: plan.useClipSound,
        videoKey,
        onProgress: (percent) => setPhase({ kind: "rendering", percent }),
      });
      const uri = await finishedVideoUri(result.videoKey);
      setPhase({
        kind: "done",
        videoKey: result.videoKey,
        videoSrc: uri ? Capacitor.convertFileSrc(uri) : null,
        soundFallback: result.soundFallback,
      });
      void reportVideoMade(slug, qrKey)
        .then(({ videosMade }) => setStatus((s) => (s ? { ...s, videosMade } : s)))
        .catch(() => undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setPhase({ kind: "ready" });
      setNotice(t("campaign.createFailed", { reason }));
    }
  }, [campaign, clip, qrKey, slug, sound, statement, t]);

  const fileName = useMemo(() => safeFileName(campaign?.merchant.name ?? ""), [campaign]);

  const onShare = useCallback(async () => {
    if (phase.kind !== "done") return;
    setBusy("share");
    setNotice(null);
    try {
      await shareCampaignVideo(phase.videoKey, fileName);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Closing the share sheet without choosing is not a failure.
      if (!/cancel/i.test(reason)) setNotice(t("campaign.actionFailed", { reason }));
    } finally {
      setBusy(null);
    }
  }, [fileName, phase, t]);

  const onSave = useCallback(async () => {
    if (phase.kind !== "done") return;
    setBusy("save");
    setNotice(null);
    try {
      const saved = await saveCampaignVideo(phase.videoKey, fileName);
      if (saved) setNotice(t("campaign.saved", { location: saved.location }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!/cancel/i.test(reason)) setNotice(t("campaign.actionFailed", { reason }));
    } finally {
      setBusy(null);
    }
  }, [fileName, phase, t]);

  const onPost = useCallback(async () => {
    if (!postUrl.trim()) return;
    setBusy("post");
    setNotice(null);
    try {
      await addCampaignPost(slug, qrKey, postUrl.trim());
      setPostSaved(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [postUrl, qrKey, slug]);

  const onClaim = useCallback(async () => {
    setBusy("claim");
    setNotice(null);
    try {
      const result = await claimCampaignReward(slug, qrKey);
      setClaim(result);
      setStatus((s) =>
        s
          ? {
              ...s,
              reward: { ...s.reward, lastGrantedAt: result.lastGrantedAt, nextEligibleAt: result.nextEligibleAt },
            }
          : s
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [qrKey, slug]);

  const reset = useCallback(() => {
    setClip(null);
    setPostUrl("");
    setPostSaved(false);
    setNotice(null);
    setPhase({ kind: "ready" });
  }, []);

  if (phase.kind === "loading") {
    return <Shell><p className="py-16 text-center text-sm text-slate-500">{t("campaign.loading")}</p></Shell>;
  }
  if (phase.kind === "error" || !campaign || !status) {
    return (
      <Shell>
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-base font-medium text-slate-900">
            {phase.kind === "error" ? phase.message : t("campaign.error.generic")}
          </p>
        </div>
      </Shell>
    );
  }

  const overCap = clip && clip.seconds > campaign.limits.maxClipSeconds;
  const rendering = phase.kind === "rendering";

  return (
    <Shell>
      {/* Who and what: the shop, the offer, this creator's code. */}
      <header className="rounded-2xl bg-slate-900 p-5 text-white">
        {campaign.merchant.category && (
          <p className="text-xs font-semibold uppercase tracking-wider text-white/60">{campaign.merchant.category}</p>
        )}
        <h1 className="mt-1 text-2xl font-bold leading-tight">{campaign.merchant.name}</h1>
        {campaign.merchant.location && <p className="text-sm text-white/70">{campaign.merchant.location}</p>}
        <p className="mt-4 text-sm leading-relaxed text-white/90">
          {t("campaign.offer", { merchant: campaign.merchant.name, discount: campaign.discountLabel })}
        </p>
        {campaign.rewardDescription && (
          <p className="mt-1 text-sm text-amber-300">{t("campaign.reward", { reward: campaign.rewardDescription })}</p>
        )}
        <div className="mt-4 flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-white/60">{t("campaign.codeLabel")}</span>
          <span className="font-mono text-2xl font-bold tracking-[0.25em]">{status.referralCode}</span>
        </div>
      </header>

      {notice && (
        <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </p>
      )}

      {phase.kind === "done" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-slate-900">{t("campaign.done.title")}</h2>
          {phase.videoSrc && (
            <video
              src={phase.videoSrc}
              controls
              playsInline
              className="mx-auto aspect-[9/16] max-h-[60vh] w-auto rounded-2xl bg-black"
            />
          )}
          {phase.soundFallback && <p className="text-xs text-slate-500">{t("campaign.soundFallback")}</p>}
          <div className="grid grid-cols-2 gap-3">
            <BigButton onClick={() => void onShare()} disabled={busy !== null} primary>
              {t("campaign.share")}
            </BigButton>
            <BigButton onClick={() => void onSave()} disabled={busy !== null}>
              {t("campaign.save")}
            </BigButton>
          </div>
          <p className="text-sm text-slate-600">{t("campaign.postHint")}</p>

          <BigButton onClick={() => void onClaim()} disabled={busy !== null} accent>
            {t("campaign.claim.button")}
          </BigButton>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <label className="text-sm font-medium text-slate-800" htmlFor="campaign-post-url">
              {t("campaign.post.label")}
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="campaign-post-url"
                type="url"
                inputMode="url"
                value={postUrl}
                onChange={(event) => {
                  setPostUrl(event.target.value);
                  setPostSaved(false);
                }}
                placeholder={t("campaign.post.placeholder")}
                className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-base"
              />
              <button
                type="button"
                onClick={() => void onPost()}
                disabled={busy !== null || !postUrl.trim()}
                className="min-h-[44px] rounded-lg bg-slate-800 px-4 text-sm font-medium text-white disabled:opacity-40"
              >
                {t("campaign.post.add")}
              </button>
            </div>
            {postSaved && <p className="mt-2 text-xs text-emerald-700">{t("campaign.post.added")}</p>}
          </div>

          <button type="button" onClick={reset} className="min-h-[44px] text-sm font-medium text-blue-700">
            {t("campaign.makeAnother")}
          </button>
        </section>
      ) : (
        <>
          {/* 1 · Shoot */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-bold text-slate-900">{t("campaign.step.shoot")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("campaign.shoot.hint")}</p>
            {clip && (
              <div className="mt-3 flex items-center gap-3">
                <video src={clip.url} muted playsInline className="h-28 w-16 rounded-lg bg-black object-cover" />
                <div className="text-sm text-slate-700">
                  <p className="font-medium">{t("campaign.shoot.length", { seconds: Math.round(clip.seconds) })}</p>
                  {overCap && (
                    <p className="text-xs text-slate-500">
                      {t("campaign.shoot.trimmed", { seconds: campaign.limits.maxClipSeconds })}
                    </p>
                  )}
                </div>
              </div>
            )}
            {clipError && <p className="mt-2 text-sm text-red-700">{clipError}</p>}
            <div className="mt-3 grid grid-cols-1 gap-2">
              <FileButton accept="video/*" capture primary={!clip} disabled={rendering} onFile={onPick}>
                {clip ? t("campaign.shoot.again") : t("campaign.shoot.record")}
              </FileButton>
              <FileButton accept="video/*" disabled={rendering} onFile={onPick}>
                {t("campaign.shoot.pick")}
              </FileButton>
            </div>
          </section>

          {/* 2 · Words */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-bold text-slate-900">{t("campaign.step.words")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("campaign.words.hint")}</p>
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              maxLength={campaign.limits.statementMaxChars * 2}
              rows={2}
              disabled={rendering}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </section>

          {/* 3 · Sound */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-bold text-slate-900">{t("campaign.step.sound")}</h2>
            <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {[{ id: CLIP_SOUND, label: t("campaign.sound.clip"), url: "" }, ...campaign.sounds].map((option) => (
                <li key={option.id} className="flex items-center gap-2">
                  <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 active:bg-slate-50">
                    <input
                      type="radio"
                      name="campaign-sound"
                      checked={sound === option.id}
                      onChange={() => setSound(option.id)}
                      disabled={rendering}
                    />
                    <span className="text-sm text-slate-800">{option.label}</span>
                  </label>
                  {option.url && (
                    <button
                      type="button"
                      onClick={() => togglePreview(option.id, option.url)}
                      className="min-h-[36px] rounded-md px-3 text-xs font-medium text-blue-700"
                    >
                      {playing === option.id ? t("campaign.sound.stop") : t("campaign.sound.play")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <BigButton onClick={() => void create()} disabled={!clip || rendering} primary>
            {rendering
              ? phase.percent == null
                ? t("campaign.preparing")
                : t("campaign.creating", { percent: phase.percent })
              : t("campaign.create")}
          </BigButton>
          {rendering && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${phase.percent ?? 3}%` }}
              />
            </div>
          )}
        </>
      )}

      <p className="pb-8 text-center text-xs text-slate-400">{t("campaign.privacy")}</p>

      {claim && (
        <ClaimScreen
          claim={claim}
          merchant={campaign.merchant.name}
          onClose={() => setClaim(null)}
          dateText={(iso) => formatDate(iso, locale)}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">{children}</div>;
}

function BigButton({
  children,
  onClick,
  disabled,
  primary,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "min-h-[52px] rounded-xl px-4 text-base font-semibold transition-opacity disabled:opacity-40 " +
        (accent
          ? "bg-amber-400 text-slate-900"
          : primary
            ? "bg-blue-600 text-white"
            : "border border-slate-300 bg-white text-slate-800")
      }
    >
      {children}
    </button>
  );
}

function FileButton({
  children,
  accept,
  capture,
  primary,
  disabled,
  onFile,
}: {
  children: React.ReactNode;
  accept: string;
  capture?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <label
      className={
        "flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl px-4 text-sm font-semibold " +
        (disabled ? "pointer-events-none opacity-40 " : "") +
        (primary ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-800")
      }
    >
      {children}
      <input
        type="file"
        accept={accept}
        {...(capture ? { capture: "environment" as const } : {})}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}

/**
 * What the customer shows staff. It is LIVE — a running clock and a moving
 * band — so an old screenshot is easy to tell apart from the real screen.
 */
function ClaimScreen({
  claim,
  merchant,
  onClose,
  dateText,
}: {
  claim: RewardClaimResult;
  merchant: string;
  onClose: () => void;
  dateText: (iso: string) => string;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 overflow-hidden p-6 text-center " +
        (claim.granted ? "bg-emerald-600 text-white" : "bg-slate-800 text-white")
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2 animate-pulse bg-white/70"
      />
      <p className="text-sm font-medium uppercase tracking-widest text-white/80">{merchant}</p>
      {claim.granted ? (
        <>
          <p className="text-3xl font-bold leading-tight">{t("campaign.claim.granted")}</p>
          {claim.rewardDescription && <p className="text-xl text-white/90">{claim.rewardDescription}</p>}
        </>
      ) : (
        <>
          <p className="text-2xl font-bold leading-tight">
            {t("campaign.claim.refused", { date: claim.lastGrantedAt ? dateText(claim.lastGrantedAt) : "—" })}
          </p>
          {claim.nextEligibleAt && (
            <p className="text-base text-white/80">{t("campaign.claim.next", { date: dateText(claim.nextEligibleAt) })}</p>
          )}
        </>
      )}
      <p className="font-mono text-4xl font-bold tracking-[0.3em]">{claim.referralCode}</p>
      <p className="font-mono text-lg tabular-nums text-white/90">{t("campaign.claim.live", { time })}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 min-h-[48px] rounded-xl bg-white/20 px-8 text-base font-semibold"
      >
        {t("campaign.claim.close")}
      </button>
    </div>
  );
}
