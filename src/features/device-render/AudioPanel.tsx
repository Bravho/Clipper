"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MusicTrack } from "@/config/backgroundMusic";
import {
  ELEVENLABS_VOICES,
  type ElevenLabsVoiceGender,
  type ElevenLabsVoiceId,
} from "@/config/elevenLabsVoices";
import { ROUTES } from "@/config/routes";
import type { CaptionLanguage } from "@/lib/mobile/deviceRenderCaptions";
import type { EditorDocument } from "./editorState";
import type { StudioScript } from "./studioPipeline";
import { pipelineStepText, useStudioT } from "./studioI18n";
import { SoundSyncPreview } from "./SoundSyncPreview";
import { preloadVoiceSamples, voiceSampleSource, voiceSampleUrl } from "./voiceSamples";

/** Where the speaking script is, from the studio's point of view. */
export type ScriptStatus =
  | "not_submitted"
  | "writing"
  /** A draft exists, but the script is written from the approved storyboard. */
  | "waiting_storyboard"
  | "review"
  | "approved"
  | "failed";

/** Where the generated voice is. */
export type VoiceStatus = "none" | "generating" | "review" | "approved";


/** One speaker as the picker shows it. */
interface SpeakerEntry {
  id: ElevenLabsVoiceId;
  name: string;
  gender: ElevenLabsVoiceGender;
  previewUrl: string;
}

const CONFIG_SPEAKERS: SpeakerEntry[] = ELEVENLABS_VOICES.map((voice) => ({
  id: voice.id,
  name: voice.name,
  gender: voice.gender,
  previewUrl: voiceSampleUrl(voice.id),
}));

// Read once per app session: the genders do not change while the app is open.
let speakerCatalog: Promise<SpeakerEntry[]> | null = null;

/**
 * The speakers, with the genders the server resolved from ElevenLabs for any
 * voice whose gender is not written in config. Starts from the config list, so
 * the picker is usable at once and on an older server.
 */
function useVoiceCatalog(): SpeakerEntry[] {
  const [voices, setVoices] = useState<SpeakerEntry[]>(CONFIG_SPEAKERS);
  useEffect(() => {
    let live = true;
    // Normally already started when the studio opened; harmless if so.
    preloadVoiceSamples();
    speakerCatalog ??= fetch("/api/voices")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { voices?: Partial<SpeakerEntry>[] } | null) => {
        const byId = new Map((body?.voices ?? []).map((voice) => [voice.id, voice]));
        return CONFIG_SPEAKERS.map((voice) => {
          const fromServer = byId.get(voice.id);
          const gender = fromServer?.gender;
          return gender === "female" || gender === "male" ? { ...voice, gender } : voice;
        });
      })
      .catch(() => {
        speakerCatalog = null;
        return CONFIG_SPEAKERS;
      });
    void speakerCatalog.then((list) => {
      if (live) setVoices(list);
    });
    return () => {
      live = false;
    };
  }, []);
  return voices;
}

// Each caption language is named in its own script, as a language menu is.
const LANGUAGES: { id: CaptionLanguage; label: string }[] = [
  { id: "th", label: "ไทย" },
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
];

/**
 * The production takes at most two caption languages (the scene-design
 * approval keeps the first two), so the picker says so instead of letting a
 * third be chosen and silently dropped.
 */
const MAX_CAPTION_LANGUAGES = 2;

/**
 * The speaking script, the voice, and the bed.
 *
 * THE SCRIPT IS APPROVED HERE. After the media is submitted the pipeline writes
 * a speaking script alongside the storyboard; this is where the person reads
 * it, fixes it, picks a voice, and approves. Approving is the request page's
 * own approval call — it sends the storyboard as arranged in the studio with
 * it, and it starts the ElevenLabs voice. There is no second approval anywhere
 * else to keep in step with this one.
 *
 * THE VOICE MUST FIT THE STORYBOARD. Two lengths are checked against the
 * voice: the picked material (what the server enforces at approve-voice), and
 * the scenes as arranged in Storyboard right now — the video's pictures have to
 * run at least as long as the voice plus the music intro and ending, or the end
 * of the voice plays over black. Either one being short shows the over-length
 * notice. Only the material check holds "Approve the voice" (the server
 * refuses it too); a storyboard that is short is fixed in Storyboard, where
 * "Fit to the voice" lengthens the scenes in one tap, so the notice links there.
 */
export function AudioPanel({
  document,
  tracks,
  onMusicTrack,
  scriptStatus,
  script,
  currentStep,
  onScriptChange,
  scriptFitting = false,
  onFitScript = null,
  voiceScriptStale = false,
  materialSeconds = 0,
  maxVoiceSeconds = 0,
  voiceTooLong = false,
  storyboardFit = null,
  onOpenStoryboard = null,
  onFitToVoice = null,
  autoFitting = false,
  scriptBudget = null,
  voiceId,
  onVoice,
  onApprove,
  approving,
  approveError,
  voiceStatus,
  voiceUrl,
  voiceSeconds,
  onApproveVoice,
  onRegenerateVoice,
  onRemakeVoice,
  remakeBlocker = null,
  remakeDiscardsVideo = false,
  voiceMakes = null,
  voiceMakeTopUp = null,
  onBuyVoiceMakes = null,
  buyingVoiceMakes = false,
  voiceBusy,
  voiceError,
  onLanguages,
  soundConfirmed,
  onConfirm,
  confirmBlocker,
  locked,
  disabled,
}: {
  document: EditorDocument;
  tracks: MusicTrack[];
  onMusicTrack: (trackId: string | null) => void;
  scriptStatus: ScriptStatus;
  script: StudioScript | null;
  currentStep: string | null;
  onScriptChange: (change: Partial<StudioScript>) => void;
  /** The script is being rewritten from the approved storyboard. */
  scriptFitting?: boolean;
  /** Rewrite the script from the approved storyboard (null: not offered). */
  onFitScript?: (() => void) | null;
  /** The script on screen is not the one the current voice was made from. */
  voiceScriptStale?: boolean;
  /** Total length of the picked clips and photos, seconds. */
  materialSeconds?: number;
  /** The longest voice that material can carry, seconds. */
  maxVoiceSeconds?: number;
  /** The voice is longer than `maxVoiceSeconds`. */
  voiceTooLong?: boolean;
  /**
   * The voice against the storyboard's combined scene length: null before
   * there is a voice and a storyboard with shots. `need` is the voice plus
   * the music intro and ending; `fits` is false when the scenes are shorter.
   */
  storyboardFit?: { scenes: number; need: number; fits: boolean } | null;
  /** Open the Storyboard step, where the scenes can be lengthened. */
  onOpenStoryboard?: (() => void) | null;
  /** Auto-fit: stretch the scenes to the voice, then shorten the script if needed. */
  onFitToVoice?: (() => void) | null;
  /** Auto-fit is shortening the script on the server. */
  autoFitting?: boolean;
  /**
   * How long the script on screen will read, against how much speech the
   * storyboard carries (its length less the music intro and ending).
   */
  scriptBudget?: {
    estimateSeconds: number;
    carrySeconds: number;
    unitsPerSecond: number;
    unit: "th" | "en" | "vi";
  } | null;
  voiceId: ElevenLabsVoiceId;
  onVoice: (voiceId: ElevenLabsVoiceId) => void;
  onApprove: () => void;
  approving: boolean;
  approveError: string | null;
  voiceStatus: VoiceStatus;
  voiceUrl: string | null;
  voiceSeconds: number | null;
  onApproveVoice: () => void;
  onRegenerateVoice: () => void;
  /** Make the voice again after it was approved (null: not offered). */
  onRemakeVoice?: (() => void) | null;
  /** Voice makes used / allowed for this request; null from an older server. */
  voiceMakes?: { used: number; limit: number } | null;
  /** More voice makes for credits, and the wallet balance; null from an older server. */
  voiceMakeTopUp?: { makes: number; priceCredits: number; balanceCredits: number | null } | null;
  /** Buy one pack of voice makes (called after the requester confirms the price). */
  onBuyVoiceMakes?: (() => void) | null;
  buyingVoiceMakes?: boolean;
  /** Why the approved voice cannot be made again right now, or null. */
  remakeBlocker?: string | null;
  /** Remaking the voice sets the finished main video aside. */
  remakeDiscardsVideo?: boolean;
  voiceBusy: boolean;
  voiceError: string | null;
  onLanguages: (languages: CaptionLanguage[]) => void;
  /** The person has confirmed the sound and moved on to Graphic. */
  soundConfirmed: boolean;
  onConfirm: () => void;
  /** Why Confirm cannot be pressed yet, or null when it can. */
  confirmBlocker: string | null;
  /** Production has started: the choices here are what is being rendered. */
  locked: boolean;
  disabled: boolean;
}) {
  const t = useStudioT();
  const choicesDisabled = disabled || locked;
  // Voice makes left for this video (config/requestLimits.ts; the server
  // refuses the next one anyway, this only says so before it is pressed).
  const makesLeft = voiceMakes ? Math.max(0, voiceMakes.limit - voiceMakes.used) : null;
  const makesExhausted = makesLeft === 0;
  const makesNote =
    voiceMakes && makesLeft !== null ? (
      <p className="studio-counter" style={{ textAlign: "left" }}>
        {makesExhausted
          ? t("studio.audio.makesUsedUp", { limit: voiceMakes.limit })
          : t("studio.audio.makesLeft", { left: makesLeft, limit: voiceMakes.limit })}
      </p>
    ) : null;
  // ── speakers: names, genders (resolved by the server for voices whose
  // gender is not written in config), and a Thai sample of each ──
  const voices = useVoiceCatalog();
  const genderWord = (gender: ElevenLabsVoiceGender) =>
    gender === "female"
      ? t("studio.audio.voice.female")
      : gender === "male"
        ? t("studio.audio.voice.male")
        : null;

  // ── previews: one shared player, one track or voice sample at a time ──
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    player.current?.pause();
    setPlaying(null);
  }, []);

  const togglePlay = useCallback(
    (key: string, url: string) => {
      if (playing === key) {
        stopPreview();
        return;
      }
      if (!player.current) {
        player.current = new Audio();
        player.current.addEventListener("ended", () => setPlaying(null));
      }
      const audio = player.current;
      audio.pause();
      audio.src = url;
      audio.currentTime = 0;
      setPlaying(key);
      setPreviewFailed(null);
      void audio.play().catch(() => {
        setPlaying(null);
        setPreviewFailed(key);
      });
    },
    [playing, stopPreview]
  );
  const togglePreview = useCallback(
    (track: MusicTrack) => togglePlay(`music:${track.id}`, track.url),
    [togglePlay]
  );

  // Leaving the step must not leave music playing under the next one.
  useEffect(
    () => () => {
      player.current?.pause();
      player.current = null;
    },
    []
  );

  /**
   * The speaker list: ▶ plays a short Thai sample (the same sentence for
   * every voice, made once on the server — it never uses a voice make), the
   * row picks the voice. Same shape as the background-music list below.
   */
  const speakerList = (pickDisabled: boolean) => (
    <ul
      className="studio-track-list"
      role="radiogroup"
      aria-label={t("studio.audio.speaker")}
      style={{ marginBottom: 4 }}
    >
      {voices.map((voice) => {
        const selected = voiceId === voice.id;
        const key = `voice:${voice.id}`;
        const isPlaying = playing === key;
        const gender = genderWord(voice.gender);
        return (
          <li key={voice.id} className="studio-track-row">
            <button
              type="button"
              className="studio-track-play studio-track-play-button"
              aria-label={
                isPlaying
                  ? t("studio.audio.stopTrack", { track: voice.name })
                  : t("studio.audio.listenVoice", { voice: voice.name })
              }
              aria-pressed={isPlaying}
              onClick={() => togglePlay(key, voiceSampleSource(voice.id))}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className="studio-track"
              disabled={pickDisabled}
              onClick={() => onVoice(voice.id)}
            >
              <span className="studio-track-label">
                {voice.name}
                {gender && (
                  <span style={{ color: "var(--s-text-muted)", fontWeight: 500 }}>
                    {" : "}
                    {gender}
                  </span>
                )}
              </span>
              <span className="studio-track-check" aria-hidden>
                {selected ? "✓" : ""}
              </span>
            </button>
          </li>
        );
      })}
      {previewFailed?.startsWith("voice:") && (
        <li>
          <p className="studio-counter" style={{ textAlign: "left" }}>
            {t("studio.audio.previewFailed")}
          </p>
        </li>
      )}
    </ul>
  );

  // ── more voice makes for credits, once the included ones are used ──
  const [confirmingTopUp, setConfirmingTopUp] = useState(false);
  const canBuyMakes =
    makesExhausted && Boolean(voiceMakeTopUp) && Boolean(onBuyVoiceMakes) && voiceStatus === "review";
  const topUpCard =
    canBuyMakes && voiceMakeTopUp ? (
      <div className="studio-note studio-note-accent" role="status" style={{ marginTop: 10 }}>
        <p style={{ margin: 0 }}>
          {t("studio.audio.topUpOffer", {
            makes: voiceMakeTopUp.makes,
            price: voiceMakeTopUp.priceCredits,
          })}
        </p>
        {voiceMakeTopUp.balanceCredits != null && (
          <p className="studio-counter" style={{ textAlign: "left", margin: "6px 0 0" }}>
            {t("studio.audio.topUpBalance", { balance: voiceMakeTopUp.balanceCredits })}
          </p>
        )}
        {voiceMakeTopUp.balanceCredits != null &&
        voiceMakeTopUp.balanceCredits < voiceMakeTopUp.priceCredits ? (
          <>
            <p style={{ margin: "8px 0 0" }}>
              {t("studio.audio.topUpShort", {
                price: voiceMakeTopUp.priceCredits,
                balance: voiceMakeTopUp.balanceCredits,
              })}
            </p>
            <a
              className="studio-button studio-button-ghost"
              style={{ display: "block", marginTop: 10, textAlign: "center" }}
              href={ROUTES.CREDITS}
            >
              {t("studio.audio.topUpGetCredits")}
            </a>
          </>
        ) : confirmingTopUp ? (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="studio-button studio-button-primary"
              style={{ flex: 1 }}
              disabled={disabled || buyingVoiceMakes}
              onClick={() => {
                setConfirmingTopUp(false);
                onBuyVoiceMakes?.();
              }}
            >
              {t("studio.audio.topUpConfirm", { price: voiceMakeTopUp.priceCredits })}
            </button>
            <button
              type="button"
              className="studio-button studio-button-ghost"
              style={{ flex: 1 }}
              disabled={buyingVoiceMakes}
              onClick={() => setConfirmingTopUp(false)}
            >
              {t("studio.audio.topUpCancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="studio-button studio-button-primary"
            style={{ marginTop: 10 }}
            disabled={disabled || buyingVoiceMakes}
            onClick={() => setConfirmingTopUp(true)}
          >
            {buyingVoiceMakes
              ? t("studio.audio.working")
              : t("studio.audio.topUpButton", {
                  makes: voiceMakeTopUp.makes,
                  price: voiceMakeTopUp.priceCredits,
                })}
          </button>
        )}
      </div>
    ) : null;

  const toggleLanguage = (language: CaptionLanguage) => {
    const chosen = document.captionLanguages;
    const next = chosen.includes(language)
      ? chosen.filter((item) => item !== language)
      : // Keep the stack in the overlay's own order (Thai, English, Chinese)
        // rather than in the order they happened to be tapped.
        (["th", "en", "zh"] as CaptionLanguage[]).filter(
          (item) => item === language || chosen.includes(item)
        );
    onLanguages(next);
  };

  const stepDescription = pipelineStepText(t, currentStep);

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">
          {scriptStatus === "writing" ? (
            <span className="studio-eyebrow" style={{ color: "var(--s-accent-text)" }}>
              <span className="studio-live-dot" aria-hidden />
              {t("studio.audio.writing")}
            </span>
          ) : (
            t("studio.audio.scriptTitle")
          )}
        </h2>

        {scriptStatus === "not_submitted" && (
          <p className="studio-panel-hint">{t("studio.audio.notSubmitted")}</p>
        )}

        {scriptStatus === "writing" && (
          <p className="studio-panel-hint">{t("studio.audio.writingHint")}</p>
        )}

        {scriptStatus === "waiting_storyboard" && (
          <>
            <p className="studio-panel-hint">{t("studio.audio.waitingStoryboard")}</p>
            {onOpenStoryboard && (
              <button
                type="button"
                className="studio-button studio-button-primary"
                style={{ marginTop: 10 }}
                onClick={onOpenStoryboard}
              >
                {t("studio.audio.openStoryboard")}
              </button>
            )}
          </>
        )}

        {scriptStatus === "failed" && (
          <p className="studio-note studio-note-danger">{t("studio.audio.failed")}</p>
        )}

        {(scriptStatus === "review" || scriptStatus === "approved") && script && (
          <>
            <p className="studio-panel-hint">
              {scriptStatus === "review"
                ? t("studio.audio.reviewHint")
                : t("studio.audio.approvedHint")}
            </p>

            {/* Always editable. Once a voice exists, an edit means the voice
                no longer says what is written, which is said right below. The
                post caption is not edited here: it is written for each channel
                when the videos go to Channel Management. */}
            <label className="studio-field">
              <span className="studio-label">{t("studio.audio.script")}</span>
              <textarea
                className="studio-textarea"
                style={{ minHeight: 160 }}
                value={script.text}
                readOnly={approving || scriptFitting}
                onChange={(event) => onScriptChange({ text: event.target.value })}
              />
              <p className="studio-counter">
                {t("studio.audio.characters", { count: script.text.trim().length })}
              </p>
              {scriptBudget ? (
                // The script against the storyboard: written a little long on
                // purpose, so the person trims rather than writes.
                (() => {
                  const over = scriptBudget.estimateSeconds - scriptBudget.carrySeconds;
                  const fits = over <= 0.05;
                  return (
                    <p
                      className={fits ? "studio-counter" : "studio-note studio-note-warning"}
                      style={{ textAlign: "left", marginTop: 6 }}
                    >
                      {t("studio.audio.budgetReads", {
                        reads: scriptBudget.estimateSeconds.toFixed(1),
                        carry: scriptBudget.carrySeconds.toFixed(1),
                      })}{" "}
                      {fits
                        ? t("studio.audio.budgetFits")
                        : t(
                            scriptBudget.unit === "th"
                              ? "studio.audio.budgetTrimThai"
                              : "studio.audio.budgetTrimWords",
                            {
                              seconds: over.toFixed(1),
                              units: Math.ceil(over * scriptBudget.unitsPerSecond),
                            }
                          )}
                    </p>
                  );
                })()
              ) : (
                materialSeconds > 0 && (
                  <p className="studio-counter" style={{ textAlign: "left" }}>
                    {t("studio.audio.materialHint", {
                      material: materialSeconds.toFixed(1),
                      max: maxVoiceSeconds.toFixed(1),
                    })}
                  </p>
                )
              )}
            </label>

            {voiceScriptStale && (
              <div className="studio-note studio-note-warning" role="status" style={{ marginBottom: 12 }}>
                <p style={{ margin: 0 }}>
                  <strong>{t("studio.audio.staleTitle")}</strong> {t("studio.audio.staleBody")}
                </p>
                {voiceStatus === "generating" ? (
                  <p style={{ margin: "8px 0 0" }}>{t("studio.audio.staleWait")}</p>
                ) : voiceStatus === "approved" && (!onRemakeVoice || remakeBlocker) ? (
                  <p style={{ margin: "8px 0 0" }}>{remakeBlocker ?? t("studio.audio.remakeFinal")}</p>
                ) : (
                  <button
                    type="button"
                    className="studio-button studio-button-primary"
                    style={{ marginTop: 10 }}
                    disabled={disabled || voiceBusy || !script.text.trim() || makesExhausted}
                    onClick={() =>
                      voiceStatus === "approved" && onRemakeVoice
                        ? onRemakeVoice()
                        : onRegenerateVoice()
                    }
                  >
                    {voiceBusy ? t("studio.audio.working") : t("studio.audio.makeAgainEdited")}
                  </button>
                )}
                {/* Says WHY the button is grey when the makes are used up,
                    and offers more right here. */}
                {makesExhausted && voiceStatus !== "generating" && makesNote}
                {voiceStatus !== "generating" && topUpCard}
              </div>
            )}

            {scriptStatus === "review" && scriptFitting && (
              <p className="studio-note studio-note-accent" role="status" style={{ marginBottom: 12 }}>
                <span className="studio-live-dot" aria-hidden /> {t("studio.audio.fittingScript")}
              </p>
            )}

            {scriptStatus === "review" && onFitScript && !scriptFitting && (
              <>
                <button
                  type="button"
                  className="studio-button studio-button-ghost"
                  style={{ marginBottom: 6 }}
                  disabled={disabled || approving}
                  onClick={onFitScript}
                >
                  {t("studio.audio.fitScript")}
                </button>
                <p className="studio-counter" style={{ textAlign: "left", marginTop: 0 }}>
                  {t("studio.audio.fitScriptHint")}
                </p>
              </>
            )}

            {scriptStatus === "review" && (
              <>
                <span className="studio-label">{t("studio.audio.voice")}</span>
                <p className="studio-counter" style={{ textAlign: "left", marginTop: 0 }}>
                  {t("studio.audio.voicePickHint")}
                </p>
                {speakerList(disabled || approving)}

                <button
                  type="button"
                  className="studio-button studio-button-primary"
                  style={{ marginTop: 16 }}
                  disabled={disabled || approving || scriptFitting || !script.text.trim()}
                  onClick={onApprove}
                >
                  {approving ? t("studio.audio.approving") : t("studio.audio.approveScript")}
                </button>
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  {t("studio.audio.approvedWith")}
                </p>
              </>
            )}

            {scriptStatus === "approved" && stepDescription && (
              <p className="studio-note studio-note-accent">{stepDescription}</p>
            )}
          </>
        )}

        {approveError && (
          <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
            {approveError}
          </p>
        )}
      </section>

      {voiceStatus !== "none" && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">
            {voiceStatus === "generating" ? (
              <span className="studio-eyebrow" style={{ color: "var(--s-accent-text)" }}>
                <span className="studio-live-dot" aria-hidden />
                {t("studio.audio.making")}
              </span>
            ) : (
              t("studio.audio.voice")
            )}
          </h2>

          {voiceStatus === "generating" && (
            <p className="studio-panel-hint">{t("studio.audio.makingHint")}</p>
          )}

          {voiceStatus !== "generating" && voiceUrl && (
            <>
              {/* The voice bar plays the storyboard with it, on the rendered
                  video's clock (music lead-in, dissolves, black tail), so the
                  narration can be checked against the pictures. With no shots
                  yet there is nothing to show, and the plain bar remains. */}
              {document.scenes.some((scene) => scene.shots.length > 0) ? (
                <SoundSyncPreview
                  key={voiceUrl}
                  document={document}
                  voiceUrl={voiceUrl}
                  voiceSeconds={voiceSeconds}
                  musicUrl={tracks.find((track) => track.id === document.musicTrackId)?.url ?? null}
                />
              ) : (
                <audio
                  key={voiceUrl}
                  src={voiceUrl}
                  controls
                  preload="metadata"
                  style={{ width: "100%" }}
                />
              )}
              {voiceSeconds != null && (
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  {t("studio.audio.voiceLength", { seconds: voiceSeconds.toFixed(1) })}
                  {storyboardFit
                    ? ` · ${t("studio.audio.storyboardLength", {
                        scenes: storyboardFit.scenes.toFixed(1),
                        need: storyboardFit.need.toFixed(1),
                      })}`
                    : ""}
                </p>
              )}
              {/* Shown whatever the voice's state: a storyboard trimmed after
                  the voice was approved is just as short. */}
              {voiceSeconds != null && storyboardFit && !storyboardFit.fits && (
                <p className="studio-note studio-note-danger" role="alert" style={{ marginTop: 8 }}>
                  {t(
                    voiceStatus === "approved"
                      ? "studio.audio.voiceOverStoryboardApproved"
                      : "studio.audio.voiceOverStoryboard",
                    {
                      voice: voiceSeconds.toFixed(1),
                      scenes: storyboardFit.scenes.toFixed(1),
                      need: storyboardFit.need.toFixed(1),
                    }
                  )}
                  {/* One tap fixes it here: the scenes are stretched to the
                      voice. Storyboard stays a tap away for fixing it by hand. */}
                  {onFitToVoice && (
                    <>
                      <button
                        type="button"
                        className="studio-button studio-button-primary"
                        style={{ display: "block", width: "100%", marginTop: 10 }}
                        disabled={disabled || autoFitting || voiceBusy}
                        onClick={onFitToVoice}
                      >
                        {autoFitting ? t("studio.audio.working") : t("studio.audio.fitToVoice")}
                      </button>
                      <span
                        className="studio-counter"
                        style={{ display: "block", textAlign: "left", marginTop: 6 }}
                      >
                        {t("studio.audio.autoFitHint")}
                      </span>
                    </>
                  )}
                  {onOpenStoryboard && (
                    <button
                      type="button"
                      className="studio-button studio-button-ghost"
                      style={{ display: "block", width: "100%", marginTop: 8 }}
                      onClick={onOpenStoryboard}
                    >
                      {t("studio.audio.openStoryboard")}
                    </button>
                  )}
                </p>
              )}
            </>
          )}

          {voiceStatus === "review" && (
            <>
              <span className="studio-label" style={{ marginTop: 12 }}>
                {t("studio.audio.speaker")}
              </span>
              {speakerList(disabled || voiceBusy)}
              <button
                type="button"
                className="studio-button studio-button-primary"
                style={{ marginTop: 14 }}
                disabled={disabled || voiceBusy || voiceTooLong || voiceScriptStale}
                onClick={onApproveVoice}
              >
                {voiceBusy ? t("studio.audio.working") : t("studio.audio.approveVoice")}
              </button>
              {voiceTooLong && voiceSeconds != null && (
                <p className="studio-note studio-note-danger" role="alert" style={{ marginTop: 8 }}>
                  {t("studio.audio.voiceTooLong", {
                    voice: voiceSeconds.toFixed(1),
                    material: materialSeconds.toFixed(1),
                    max: maxVoiceSeconds.toFixed(1),
                  })}
                </p>
              )}
              {!voiceTooLong && voiceScriptStale && (
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  {t("studio.audio.approveStale")}
                </p>
              )}
              <button
                type="button"
                className="studio-button studio-button-ghost"
                style={{ marginTop: 8 }}
                disabled={disabled || voiceBusy || makesExhausted}
                onClick={onRegenerateVoice}
              >
                {t("studio.audio.again")}
              </button>
              {makesNote}
              {!voiceScriptStale && topUpCard}
            </>
          )}

          {voiceStatus === "approved" && (
            <p className="studio-note studio-note-positive" style={{ marginTop: 10 }}>
              {t("studio.audio.voiceApproved")}
            </p>
          )}

          {/* An approved voice can still be made again — a different speaker,
              or the same one read afresh. It goes back to review, so it is
              listened to and approved again before anything is rendered. */}
          {voiceStatus === "approved" && onRemakeVoice && (
            <>
              <span className="studio-label" style={{ marginTop: 14 }}>
                {t("studio.audio.speaker")}
              </span>
              {speakerList(disabled || voiceBusy || remakeBlocker !== null)}
              <button
                type="button"
                className="studio-button studio-button-ghost"
                style={{ marginTop: 10 }}
                disabled={disabled || voiceBusy || remakeBlocker !== null || makesExhausted}
                onClick={onRemakeVoice}
              >
                {voiceBusy ? t("studio.audio.working") : t("studio.audio.remake")}
              </button>
              {makesNote}
              <p className="studio-counter" style={{ textAlign: "left" }}>
                {remakeBlocker ??
                  (remakeDiscardsVideo
                    ? t("studio.audio.remakeHintVideo")
                    : t("studio.audio.remakeHint"))}
              </p>
            </>
          )}

          {voiceError && (
            <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
              {voiceError}
            </p>
          )}
        </section>
      )}

      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.audio.background")}</h2>
        <p className="studio-panel-hint">{t("studio.audio.backgroundHint")}</p>
        <ul className="studio-track-list" role="radiogroup" aria-label={t("studio.audio.backgroundAria")}>
          <li>
            <button
              type="button"
              role="radio"
              aria-checked={document.musicTrackId === null}
              className="studio-track"
              disabled={choicesDisabled}
              onClick={() => onMusicTrack(null)}
            >
              <span className="studio-track-play" aria-hidden>
                –
              </span>
              <span className="studio-track-label">{t("studio.audio.noMusic")}</span>
              <span className="studio-track-check" aria-hidden>
                {document.musicTrackId === null ? "✓" : ""}
              </span>
            </button>
          </li>
          {tracks.map((track) => {
            const selected = document.musicTrackId === track.id;
            const isPlaying = playing === `music:${track.id}`;
            return (
              <li key={track.id} className="studio-track-row">
                <button
                  type="button"
                  className="studio-track-play studio-track-play-button"
                  aria-label={
                    isPlaying
                      ? t("studio.audio.stopTrack", { track: track.label })
                      : t("studio.audio.listenTrack", { track: track.label })
                  }
                  aria-pressed={isPlaying}
                  onClick={() => togglePreview(track)}
                >
                  {isPlaying ? "❚❚" : "▶"}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="studio-track"
                  disabled={choicesDisabled}
                  onClick={() => onMusicTrack(track.id)}
                >
                  <span className="studio-track-label">{track.label}</span>
                  <span className="studio-track-check" aria-hidden>
                    {selected ? "✓" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.audio.captions")}</h2>
        <p className="studio-panel-hint">
          {t("studio.audio.captionsHint", { max: MAX_CAPTION_LANGUAGES })}
        </p>

        <div className="studio-chip-row" role="group" aria-label={t("studio.audio.captionsAria")}>
          {LANGUAGES.map((language) => {
            const chosen = document.captionLanguages.includes(language.id);
            const full = !chosen && document.captionLanguages.length >= MAX_CAPTION_LANGUAGES;
            return (
              <button
                key={language.id}
                type="button"
                className="studio-chip"
                aria-pressed={chosen}
                disabled={choicesDisabled || full}
                onClick={() => toggleLanguage(language.id)}
              >
                <strong>{language.label}</strong>
                <span style={{ color: "var(--s-text-faint)", fontWeight: 500 }}>
                  {t(`studio.audio.lang.${language.id}`)}
                </span>
              </button>
            );
          })}
        </div>

        {document.captionLanguages.length === 0 && (
          <p className="studio-note studio-note-warning" style={{ marginTop: 12 }}>
            {t("studio.audio.noCaptions")}
          </p>
        )}
      </section>


      <section className="studio-panel">
        <div className="studio-approve" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          <button
            type="button"
            className="studio-button studio-button-primary"
            disabled={disabled || confirmBlocker !== null}
            onClick={() => {
              stopPreview();
              onConfirm();
            }}
          >
            {soundConfirmed ? t("studio.audio.confirmed") : t("studio.audio.confirm")}
          </button>
          <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
            {confirmBlocker ??
              (locked
                ? t("studio.audio.lockedHint")
                : t("studio.audio.confirmHint"))}
          </p>
        </div>
      </section>
    </>
  );
}
