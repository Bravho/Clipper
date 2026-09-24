"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MusicTrack } from "@/config/backgroundMusic";
import { ELEVENLABS_VOICES, type ElevenLabsVoiceId } from "@/config/elevenLabsVoices";
import {
  PIPELINE_STEP_DESCRIPTIONS,
  type VideoGenerationStep,
} from "@/domain/enums/VideoGenerationStep";
import {
  DEVICE_MUSIC_BED_VOLUME,
  DEVICE_MUSIC_LEAD_IN_SECONDS,
} from "@/lib/mobile/deviceRenderAudio";
import type { CaptionLanguage } from "@/lib/mobile/deviceRenderCaptions";
import type { EditorDocument } from "./editorState";
import type { StudioScript } from "./studioPipeline";

/** Where the speaking script is, from the studio's point of view. */
export type ScriptStatus = "not_submitted" | "writing" | "review" | "approved" | "failed";

/** Where the generated voice is. */
export type VoiceStatus = "none" | "generating" | "review" | "approved";

// Plain-language names for the two voices, for an English screen. The ids are
// the server's; only the words are the studio's.
const VOICE_LABELS: Record<string, string> = {
  female: "Female voice",
  male: "Male voice",
};

const LANGUAGES: { id: CaptionLanguage; label: string; note: string }[] = [
  { id: "th", label: "ไทย", note: "White, largest" },
  { id: "en", label: "English", note: "White" },
  { id: "zh", label: "中文", note: "Yellow" },
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
  const choicesDisabled = disabled || locked;

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

  const stepDescription = currentStep
    ? PIPELINE_STEP_DESCRIPTIONS[currentStep as VideoGenerationStep]
    : null;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">
          {scriptStatus === "writing" ? (
            <span className="studio-eyebrow" style={{ color: "var(--s-accent)" }}>
              <span className="studio-live-dot" aria-hidden />
              Writing the speaking script
            </span>
          ) : (
            "Speaking script"
          )}
        </h2>

        {scriptStatus === "not_submitted" && (
          <p className="studio-panel-hint">
            The speaking script is written from your brief and your material once
            you submit the media.
          </p>
        )}

        {scriptStatus === "writing" && (
          <p className="studio-panel-hint">
            It is written together with the storyboard and appears here for you to
            check as soon as it is ready.
          </p>
        )}

        {scriptStatus === "failed" && (
          <p className="studio-note studio-note-danger">
            The script could not be written. Open the request from your request list
            to retry it.
          </p>
        )}

        {(scriptStatus === "review" || scriptStatus === "approved") && script && (
          <>
            <p className="studio-panel-hint">
              {scriptStatus === "review"
                ? "Read it aloud once. Edit anything that does not sound like you, then approve it to make the voice."
                : "Approved. The voice is made from this script."}
            </p>

            <label className="studio-field">
              <span className="studio-label">Script</span>
              <textarea
                className="studio-textarea"
                style={{ minHeight: 160 }}
                value={script.text}
                readOnly={scriptStatus !== "review"}
                disabled={disabled || approving}
                onChange={(event) => onScriptChange({ text: event.target.value })}
              />
              <p className="studio-counter">{script.text.trim().length} characters</p>
            </label>

            <label className="studio-field">
              <span className="studio-label">Post caption</span>
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
                <span className="studio-label">Voice</span>
                <div className="studio-chip-row" role="group" aria-label="Voice">
                  {ELEVENLABS_VOICES.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      className="studio-chip"
                      aria-pressed={voiceId === voice.id}
                      disabled={disabled || approving}
                      onClick={() => onVoice(voice.id)}
                    >
                      <strong>{VOICE_LABELS[voice.gender] ?? voice.label}</strong>
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
                  {approving ? "Approving…" : "Approve the script and make the voice"}
                </button>
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  Your storyboard is approved with it, as it is arranged now.
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
              <span className="studio-eyebrow" style={{ color: "var(--s-accent)" }}>
                <span className="studio-live-dot" aria-hidden />
                Making the voice
              </span>
            ) : (
              "Voice"
            )}
          </h2>

          {voiceStatus === "generating" && (
            <p className="studio-panel-hint">
              ElevenLabs is reading the approved script. It appears here to listen to as soon as
              it is ready.
            </p>
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
                  {voiceSeconds.toFixed(1)}s — the storyboard must run at least this long, plus a
                  short intro and ending.
                </p>
              )}
            </>
          )}

          {voiceStatus === "review" && (
            <>
              <span className="studio-label" style={{ marginTop: 12 }}>
                Speaker
              </span>
              <div className="studio-chip-row" role="group" aria-label="Speaker">
                {ELEVENLABS_VOICES.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    className="studio-chip"
                    aria-pressed={voiceId === voice.id}
                    disabled={disabled || voiceBusy}
                    onClick={() => onVoice(voice.id)}
                  >
                    <strong>{VOICE_LABELS[voice.gender] ?? voice.label}</strong>
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
                {voiceBusy ? "Working…" : "Approve the voice"}
              </button>
              <button
                type="button"
                className="studio-button studio-button-ghost"
                style={{ marginTop: 8 }}
                disabled={disabled || voiceBusy}
                onClick={onRegenerateVoice}
              >
                Make it again with the selected speaker
              </button>
            </>
          )}

          {voiceStatus === "approved" && (
            <p className="studio-note studio-note-positive" style={{ marginTop: 10 }}>
              Voice approved. Choose the background and captions, then confirm the sound.
            </p>
          )}

          {voiceError && (
            <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
              {voiceError}
            </p>
          )}
        </section>
      )}

      <section className="studio-panel">
        <h2 className="studio-panel-title">Background</h2>
        <p className="studio-panel-hint">Tap ▶ to listen, then choose the one you want.</p>
        <ul className="studio-track-list" role="radiogroup" aria-label="Background music">
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
              <span className="studio-track-label">No background music</span>
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
                  aria-label={isPlaying ? `Stop ${track.label}` : `Listen to ${track.label}`}
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
        <h2 className="studio-panel-title">Captions</h2>
        <p className="studio-panel-hint">
          Burned into the video, stacked from the bottom in this order. Up to{" "}
          {MAX_CAPTION_LANGUAGES} languages.
        </p>

        <div className="studio-chip-row" role="group" aria-label="Caption languages">
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
                  {language.note}
                </span>
              </button>
            );
          })}
        </div>

        {document.captionLanguages.length === 0 && (
          <p className="studio-note studio-note-warning" style={{ marginTop: 12 }}>
            With no language chosen the video has no captions.
          </p>
        )}
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">How the mix is built</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, color: "var(--s-text-muted)" }}>
          <li>Opens on {DEVICE_MUSIC_LEAD_IN_SECONDS}s of music before the narration starts.</li>
          <li>The voice is levelled to −16 LUFS with a −1.5 dBTP ceiling.</li>
          <li>
            The bed sits at {Math.round(DEVICE_MUSIC_BED_VOLUME * 100)}% and ducks under speech,
            recovering between sentences and under the ending.
          </li>
          <li>Camera sound from your clips is never used.</li>
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
            {soundConfirmed ? "Confirmed — continue to Graphic" : "Confirm the sound"}
          </button>
          <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
            {confirmBlocker ??
              (locked
                ? "In production — the sound is what is being rendered."
                : "Voice, background and captions go into the render as chosen here.")}
          </p>
        </div>
      </section>
    </>
  );
}
