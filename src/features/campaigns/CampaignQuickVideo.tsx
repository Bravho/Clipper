"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";
import type {
  CreatorCampaignStatus,
  PublicCampaignView,
  PublicStoryFormat,
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
import { PhoneVerifyStep } from "@/features/campaigns/PhoneVerifyStep";

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
  // The story format the customer chose (null = the shop offers none: the original single clip).
  const [formatId, setFormatId] = useState<string | null>(null);
  // One slot per shot of the format.
  const [clips, setClips] = useState<(PickedClip | null)[]>([null]);
  const [clipErrors, setClipErrors] = useState<(string | null)[]>([null]);
  const clipUrls = useRef<string[]>([]);
  const [moodId, setMoodId] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [statementTouched, setStatementTouched] = useState(false);
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
        // One style offered: no choice to make.
        if (result.campaign.formats.length === 1) applyFormat(result.campaign.formats[0]);
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
    // applyFormat only sets state; it is stable in meaning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, qrKey, t]);

  useEffect(() => () => {
    clipUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const format: PublicStoryFormat | null = useMemo(
    () => campaign?.formats.find((f) => f.id === formatId) ?? null,
    [campaign, formatId]
  );

  /** Choose a style: one empty slot per shot, its sentence, mood and sound. */
  function applyFormat(next: PublicStoryFormat) {
    setFormatId(next.id);
    setClips(next.shots.map(() => null));
    setClipErrors(next.shots.map(() => null));
    const firstMood = next.moods[0] ?? null;
    setMoodId(firstMood?.id ?? null);
    setPick("");
    setStatementTouched(false);
    setStatement(firstMood?.defaultStatement ?? next.defaultStatement);
    setSound(firstMood?.defaultSound ?? next.defaultSound);
  }

  const chooseMood = (id: string) => {
    const mood = format?.moods.find((m) => m.id === id);
    if (!mood) return;
    setMoodId(id);
    if (!statementTouched) setStatement(mood.defaultStatement);
    setSound(mood.defaultSound);
  };

  useEffect(() => () => audioRef.current?.pause(), []);

  const setSlot = (index: number, clip: PickedClip | null, error: string | null) => {
    setClips((current) => {
      const next = [...current];
      if (next[index]) URL.revokeObjectURL(next[index]!.url);
      next[index] = clip;
      return next;
    });
    setClipErrors((current) => {
      const next = [...current];
      next[index] = error;
      return next;
    });
  };

  const onPick = useCallback(
    async (index: number, file: File | undefined) => {
      if (!file || !campaign) return;
      const min = format ? format.shots[index].minSeconds : campaign.limits.minClipSeconds;
      const url = URL.createObjectURL(file);
      clipUrls.current.push(url);
      try {
        const seconds = await readDuration(url);
        if (seconds < min) {
          URL.revokeObjectURL(url);
          setSlot(index, null, t("campaign.shoot.tooShort", { seconds: min }));
          return;
        }
        setSlot(index, { file, url, seconds }, null);
      } catch {
        URL.revokeObjectURL(url);
        setSlot(index, null, t("campaign.shoot.unreadable"));
      }
    },
    [campaign, format, t]
  );

  // Two clips cannot keep their own sound in sync: offer music only.
  const allowsClipSound = format ? format.allowsClipSound : true;
  useEffect(() => {
    if (!allowsClipSound && sound === CLIP_SOUND && format) setSound(format.defaultSound);
  }, [allowsClipSound, format, sound]);

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

  const ready = clips.length > 0 && clips.every((c) => c !== null);

  const create = useCallback(async () => {
    if (!ready || !campaign) return;
    const picked = clips as PickedClip[];
    audioRef.current?.pause();
    setPlaying(null);
    setNotice(null);
    setPhase({ kind: "rendering", percent: null });
    try {
      const plan = await fetchCampaignManifest(slug, qrKey, {
        shots: picked.map((c, index) => ({
          localId: `campaign-clip-${index + 1}`,
          mimeType: c.file.type || "video/mp4",
          durationSeconds: c.seconds,
        })),
        statement,
        sound,
        format: formatId,
        mood: moodId,
        pick: pick.trim() || null,
      });
      const videoKey = `campaign-${slug}-${Date.now()}`;
      const result = await renderCampaignVideo({
        manifest: plan.manifest,
        files: picked.map((c) => c.file),
        clipAssetIds: plan.clipAssetIds,
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
      setPhase({ kind: "ready" });
      if (error instanceof CampaignApiError && error.code === "phone_required") {
        // The server is the judge: show the phone step again.
        setStatus((s) => (s ? { ...s, phone: { ...s.phone, ok: false } } : s));
        setNotice(t("campaign.phone.needed"));
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      setNotice(t("campaign.createFailed", { reason }));
    }
  }, [campaign, clips, formatId, moodId, pick, qrKey, ready, slug, sound, statement, t]);

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
    setClips((current) => current.map(() => null));
    setClipErrors((current) => current.map(() => null));
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

  const rendering = phase.kind === "rendering";
  // The shop offers styles and none is chosen yet: show only the picker.
  const choosing = campaign.formats.length > 0 && !format;
  const fmt = (suffix: string) => t(`campaign.format.${formatId}.${suffix}` as MessageKey);

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
          {/* Choose a style (only when the shop offers more than one) */}
          {campaign.formats.length > 1 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-base font-bold text-slate-900">{t("campaign.step.style")}</h2>
              {choosing && <p className="mt-1 text-sm text-slate-600">{t("campaign.style.hint")}</p>}
              <div className="mt-3 grid grid-cols-1 gap-2">
                {campaign.formats
                  .filter((option) => choosing || option.id === formatId)
                  .map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={rendering}
                      onClick={() => applyFormat(option)}
                      className={
                        "flex min-h-[64px] items-start gap-3 rounded-xl border px-3 py-3 text-left " +
                        (option.id === formatId ? "border-blue-500 bg-blue-50" : "border-slate-200 active:bg-slate-50")
                      }
                    >
                      <span className="text-2xl leading-none" aria-hidden>{option.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">
                          {t(`campaign.format.${option.id}.name` as MessageKey)}
                        </span>
                        <span className="block text-xs leading-relaxed text-slate-600">
                          {t(`campaign.format.${option.id}.desc` as MessageKey)}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
              {!choosing && (
                <button
                  type="button"
                  disabled={rendering}
                  onClick={() => setFormatId(null)}
                  className="mt-2 min-h-[40px] text-sm font-medium text-blue-700"
                >
                  {t("campaign.style.change")}
                </button>
              )}
            </section>
          )}

          {!choosing && (
            <>
          {/* 1 · Shoot — one slot per shot */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-bold text-slate-900">{t("campaign.step.shoot")}</h2>
            {!format && <p className="mt-1 text-sm text-slate-600">{t("campaign.shoot.hint")}</p>}
            {format?.moods.length ? (
              <div className="mt-3">
                <p className="text-sm font-medium text-slate-800">{t("campaign.mood.label")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {format.moods.map((mood) => (
                    <button
                      key={mood.id}
                      type="button"
                      disabled={rendering}
                      onClick={() => chooseMood(mood.id)}
                      className={
                        "min-h-[40px] rounded-full border px-4 text-sm font-medium " +
                        (mood.id === moodId ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-700")
                      }
                    >
                      {t(`campaign.mood.${mood.id}` as MessageKey)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {clips.map((slot, index) => {
              const shot = format?.shots[index];
              const max = shot ? shot.maxSeconds : campaign.limits.maxClipSeconds;
              return (
                <div key={`${formatId ?? "classic"}-${index}`} className={index > 0 ? "mt-4 border-t border-slate-100 pt-4" : "mt-3"}>
                  {format && (
                    <p className="text-sm text-slate-700">
                      {clips.length > 1 && <span className="font-semibold">{index + 1}. </span>}
                      {fmt(`shot${index + 1}`)}
                      <span className="text-slate-400"> · {t("campaign.shoot.range", { min: shot!.minSeconds, max })}</span>
                    </p>
                  )}
                  {slot && (
                    <div className="mt-2 flex items-center gap-3">
                      <video src={slot.url} muted playsInline className="h-28 w-16 rounded-lg bg-black object-cover" />
                      <div className="text-sm text-slate-700">
                        <p className="font-medium">{t("campaign.shoot.length", { seconds: Math.round(slot.seconds) })}</p>
                        {slot.seconds > max && (
                          <p className="text-xs text-slate-500">{t("campaign.shoot.trimmed", { seconds: max })}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {clipErrors[index] && <p className="mt-2 text-sm text-red-700">{clipErrors[index]}</p>}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <FileButton accept="video/*" capture primary={!slot} disabled={rendering} onFile={(file) => void onPick(index, file)}>
                      {slot ? t("campaign.shoot.again") : t("campaign.shoot.record")}
                    </FileButton>
                    <FileButton accept="video/*" disabled={rendering} onFile={(file) => void onPick(index, file)}>
                      {t("campaign.shoot.pick")}
                    </FileButton>
                  </div>
                </div>
              );
            })}
            {format?.asksPick && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <label className="text-sm font-medium text-slate-800" htmlFor="campaign-pick">
                  {t("campaign.pick.label")}
                </label>
                <input
                  id="campaign-pick"
                  value={pick}
                  onChange={(event) => setPick(event.target.value)}
                  maxLength={22}
                  placeholder={t("campaign.pick.placeholder")}
                  disabled={rendering}
                  className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-base"
                />
              </div>
            )}
          </section>

          {/* 2 · Words */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-bold text-slate-900">{t("campaign.step.words")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("campaign.words.hint")}</p>
            <textarea
              value={statement}
              onChange={(event) => {
                setStatement(event.target.value);
                setStatementTouched(true);
              }}
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
              {[
                ...(allowsClipSound ? [{ id: CLIP_SOUND, label: t("campaign.sound.clip"), url: "" }] : []),
                ...campaign.sounds,
              ].map((option) => (
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

          {/* 4 · Phone (once per install) — so iTravy can refuse the creator's own code */}
          {status.phone.required && (
            <PhoneVerifyStep
              slug={slug}
              qrKey={qrKey}
              status={status}
              disabled={rendering}
              onVerified={(next) => {
                setStatus(next);
                setNotice(null);
              }}
            />
          )}

          <BigButton onClick={() => void create()} disabled={!ready || rendering || !status.phone.ok} primary>
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
