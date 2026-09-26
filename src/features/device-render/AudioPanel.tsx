"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MusicTrack } from "@/config/backgroundMusic";
import { ELEVENLABS_VOICES, type ElevenLabsVoiceId } from "@/config/elevenLabsVoices";
import {
  DEVICE_MUSIC_BED_VOLUME,
  DEVICE_MUSIC_LEAD_IN_SECONDS,
} from "@/lib/mobile/deviceRenderAudio";
import type { CaptionLanguage } from "@/lib/mobile/deviceRenderCaptions";
import type { EditorDocument } from "./editorState";
import type { StudioScript } from "./studioPipeline";
import { pipelineStepText, useStudioT } from "./studioI18n";

/** Where the speaking script is, from the studio's point of view. */
export type ScriptStatus = "not_submitted" | "writing" | "review" | "approved" | "failed";

/** Where the generated voice is. */
export type VoiceStatus = "none" | "generating" | "review" | "approved";


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
 * The mix numbers are shown rather than hidden because someone listening for
 * "is the bed ducking properly" needs to know what correct sounds like.
 */
export function AudioPanel({
  document,
  tracks,
  onMusicTrack,
  scriptStatus,
  script,
  currentStep,
  onScriptChange,
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
  // The voices by gender, in the studio's language. The ids are the server's;
  // only the words are the studio's.
  const voiceName = (voice: { gender: string; label: string }) =>
    voice.gender === "female"
      ? t("studio.audio.voice.female")
      : voice.gender === "male"
        ? t("studio.audio.voice.male")
        : voice.label;

  // ── background preview: one shared player, one track at a time ──
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    player.current?.pause();
    setPlaying(null);
  }, []);

  const togglePreview = useCallback(
    (track: MusicTrack) => {
      if (playing === track.id) {
        stopPreview();
        return;
      }
      if (!player.current) {
        player.current = new Audio();
        player.current.addEventListener("ended", () => setPlaying(null));
      }
      const audio = player.current;
      audio.pause();
      audio.src = track.url;
      audio.currentTime = 0;
      setPlaying(track.id);
      void audio.play().catch(() => setPlaying(null));
    },
    [playing, stopPreview]
  );

  // Leaving the step must not leave music playing under the next one.
  useEffect(
    () => () => {
      player.current?.pause();
      player.current = null;
    },
    []
  );

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

            <label className="studio-field">
              <span className="studio-label">{t("studio.audio.script")}</span>
              <textarea
                className="studio-textarea"
                style={{ minHeight: 160 }}
                value={script.text}
                readOnly={scriptStatus !== "review"}
                disabled={disabled || approving}
                onChange={(event) => onScriptChange({ text: event.target.value })}
              />
              <p className="studio-counter">
                {t("studio.audio.characters", { count: script.text.trim().length })}
              </p>
            </label>

            <label className="studio-field">
              <span className="studio-label">{t("studio.audio.postCaption")}</span>
              <textarea
                className="studio-textarea"
                style={{ minHeight: 88 }}
                value={script.caption}
                readOnly={scriptStatus !== "review"}
                disabled={disabled || approving}
                onChange={(event) => onScriptChange({ caption: event.target.value })}
              />
            </label>

            {scriptStatus === "review" && (
              <>
                <span className="studio-label">{t("studio.audio.voice")}</span>
                <div className="studio-chip-row" role="group" aria-label={t("studio.audio.voice")}>
                  {ELEVENLABS_VOICES.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      className="studio-chip"
                      aria-pressed={voiceId === voice.id}
                      disabled={disabled || approving}
                      onClick={() => onVoice(voice.id)}
                    >
                      <strong>{voiceName(voice)}</strong>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="studio-button studio-button-primary"
                  style={{ marginTop: 16 }}
                  disabled={disabled || approving || !script.text.trim()}
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
              <audio
                key={voiceUrl}
                src={voiceUrl}
                controls
                preload="metadata"
                style={{ width: "100%" }}
              />
              {voiceSeconds != null && (
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  {t("studio.audio.voiceLength", { seconds: voiceSeconds.toFixed(1) })}
                </p>
              )}
            </>
          )}

          {voiceStatus === "review" && (
            <>
              <span className="studio-label" style={{ marginTop: 12 }}>
                {t("studio.audio.speaker")}
              </span>
              <div className="studio-chip-row" role="group" aria-label={t("studio.audio.speaker")}>
                {ELEVENLABS_VOICES.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    className="studio-chip"
                    aria-pressed={voiceId === voice.id}
                    disabled={disabled || voiceBusy}
                    onClick={() => onVoice(voice.id)}
                  >
                    <strong>{voiceName(voice)}</strong>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="studio-button studio-button-primary"
                style={{ marginTop: 14 }}
                disabled={disabled || voiceBusy}
                onClick={onApproveVoice}
              >
                {voiceBusy ? t("studio.audio.working") : t("studio.audio.approveVoice")}
              </button>
              <button
                type="button"
                className="studio-button studio-button-ghost"
                style={{ marginTop: 8 }}
                disabled={disabled || voiceBusy}
                onClick={onRegenerateVoice}
              >
                {t("studio.audio.again")}
              </button>
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
              <div className="studio-chip-row" role="group" aria-label={t("studio.audio.speaker")}>
                {ELEVENLABS_VOICES.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    className="studio-chip"
                    aria-pressed={voiceId === voice.id}
                    disabled={disabled || voiceBusy || remakeBlocker !== null}
                    onClick={() => onVoice(voice.id)}
                  >
                    <strong>{voiceName(voice)}</strong>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="studio-button studio-button-ghost"
                style={{ marginTop: 10 }}
                disabled={disabled || voiceBusy || remakeBlocker !== null}
                onClick={onRemakeVoice}
              >
                {voiceBusy ? t("studio.audio.working") : t("studio.audio.remake")}
              </button>
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
            const isPlaying = playing === track.id;
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
        <h2 className="studio-panel-title">{t("studio.audio.mixTitle")}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, color: "var(--s-text-muted)" }}>
          <li>{t("studio.audio.mix1", { seconds: DEVICE_MUSIC_LEAD_IN_SECONDS })}</li>
          <li>{t("studio.audio.mix2")}</li>
          <li>{t("studio.audio.mix3", { percent: Math.round(DEVICE_MUSIC_BED_VOLUME * 100) })}</li>
          <li>{t("studio.audio.mix4")}</li>
        </ul>
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
