"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { PIPELINE_STEP_COSTS, STUDIO_MAX_DURATION_SECONDS } from "@/config/credits";
import { FORM_PLATFORMS, Platform, PLATFORM_LABELS } from "@/domain/enums/Platform";
import { geocodePlaceName } from "@/features/requests/components/GoogleMapLocationPicker";
import { briefProblems, type EditorBrief } from "./editorState";
import { useStudioT } from "./studioI18n";

// The same picker the web request form uses, loaded only when it is opened:
// the Maps script is heavy, and most people never need to move the pin that the
// place-name search already put in the right spot.
const GoogleMapLocationPicker = dynamic(
  () =>
    import("@/features/requests/components/GoogleMapLocationPicker").then(
      (module) => module.GoogleMapLocationPicker
    ),
  { ssr: false }
);

/**
 * What the video is for — and, once saved, the request itself.
 *
 * WHY THIS COMES FIRST. Three later things are decided by these answers and
 * cannot be guessed from the footage: how long the finished clip should be,
 * what the storyboard model is supposed to be selling, and the request record
 * the server's pipeline runs against. Asking afterwards means re-planning the
 * storyboard and re-timing every shot.
 *
 * WHERE THE LOCATION COMES FROM. The place name. It is looked up on Google Maps
 * with the same Geocoder the web form's picker uses, so the pin lands where the
 * web flow would have put it; the map opens only to confirm or nudge it. A
 * phone's own GPS was the wrong source — the person is often not standing in
 * the shop they are making a video about.
 *
 * WHY SAVING DOES NOT LEAVE THE STUDIO. The brief is written straight to the
 * database as a Draft request (`POST /api/requests`, later `PUT` while it is
 * still a Draft) and the studio attaches itself to the id that comes back. The
 * editing carries on here, on the phone, against that request — nothing is
 * handed to the old upload form, because that form's first job is uploading the
 * originals this pipeline exists to keep on the device.
 */


export function BriefPanel({
  brief,
  requestId,
  onChange,
  onRequestSaved,
  disabled,
}: {
  brief: EditorBrief;
  /** The request this studio is attached to, once there is one. */
  requestId: string | null;
  onChange: (change: Partial<EditorBrief>) => void;
  /** Called with the id of the request the brief was saved to. */
  onRequestSaved: (requestId: string) => void;
  disabled: boolean;
}) {
  const t = useStudioT();
  const [mapOpen, setMapOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const problems = briefProblems(brief, t);
  const hasPin = brief.latitude != null && brief.longitude != null;

  // Held stable on purpose. The picker re-runs its whole geocode-and-reset
  // effect whenever this object changes identity, and the studio re-renders on
  // its own (the availability poll) — a fresh literal each render would snap
  // the pin back while someone is dragging it.
  const pinForPicker = useMemo(
    () =>
      brief.latitude != null && brief.longitude != null
        ? { latitude: brief.latitude, longitude: brief.longitude }
        : null,
    [brief.latitude, brief.longitude]
  );
  const hasPlace = brief.placeName.trim().length > 0;

  const change = (patch: Partial<EditorBrief>) => {
    setSaved(null);
    onChange(patch);
  };

  /**
   * Resolve the place name to a pin.
   *
   * Returns the coordinates rather than only storing them, so saving can use
   * the answer in the same tick instead of waiting for a state update to land.
   */
  const findPlace = async (): Promise<{ latitude: number; longitude: number } | null> => {
    setFinding(true);
    setLocationNote(null);
    try {
      const found = await geocodePlaceName(brief.placeName);
      if (!found) {
        setLocationNote(t("studio.brief.noMatch", { place: brief.placeName.trim() }));
        return null;
      }
      const pin = {
        latitude: Number(found.latitude.toFixed(6)),
        longitude: Number(found.longitude.toFixed(6)),
      };
      change(pin);
      return pin;
    } catch (failure) {
      setLocationNote(
        failure instanceof Error ? failure.message : t("studio.brief.mapsUnreachable")
      );
      return null;
    } finally {
      setFinding(false);
    }
  };

  /**
   * One button for the whole location step: look the place name up on Google
   * Maps (unless it already has a pin from this name), then open the map on
   * that pin so the person can check it and drag it if it is off. When the
   * search finds nothing the map opens anyway, on the name, to place by hand.
   */
  const checkOnMap = async () => {
    if (!hasPin) await findPlace();
    setMapOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // The request needs a location. If the place was never looked up, look
      // it up now rather than refusing — the name is already here, and making
      // someone press a second button to supply what we can find ourselves is
      // friction for its own sake.
      let pin = hasPin ? { latitude: brief.latitude!, longitude: brief.longitude! } : null;
      if (!pin) pin = await findPlace();
      if (!pin) {
        throw new Error(t("studio.brief.setLocation"));
      }

      const payload = {
        title: brief.clipName.trim(),
        placeName: brief.placeName.trim(),
        latitude: pin.latitude,
        longitude: pin.longitude,
        description: brief.details.trim(),
        targetAudience: "",
        targetPlatforms: brief.platforms,
        durationSeconds: brief.targetSeconds,
        // Tells the server this brief is the phone studio's, which may run
        // longer than the web form's limit because the phone renders it.
        studio: true,
      };

      const response = await fetch(requestId ? `/api/requests/${requestId}` : "/api/requests", {
        method: requestId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | { requestId?: string; request?: { id?: string }; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? t("studio.brief.alreadySubmitted")
            : (body?.error ?? t("studio.brief.saveFailed"))
        );
      }

      const id = requestId ?? body?.requestId ?? body?.request?.id;
      if (!id) throw new Error(t("studio.brief.noId"));
      setSaved(id);
      onRequestSaved(id);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.brief.aboutTitle")}</h2>
        <p className="studio-panel-hint">{t("studio.brief.aboutHint")}</p>

        <label className="studio-field">
          <span className="studio-label">{t("studio.brief.clipName")}</span>
          <input
            className="studio-input"
            type="text"
            value={brief.clipName}
            maxLength={100}
            placeholder={t("studio.brief.clipNamePlaceholder")}
            disabled={disabled}
            onChange={(event) => change({ clipName: event.target.value })}
          />
        </label>

        <label className="studio-field">
          <span className="studio-label">{t("studio.brief.placeName")}</span>
          <input
            className="studio-input"
            type="text"
            value={brief.placeName}
            maxLength={150}
            placeholder={t("studio.brief.placePlaceholder")}
            disabled={disabled}
            onChange={(event) =>
              // A new name makes the old pin a pin for somewhere else.
              change({ placeName: event.target.value, latitude: null, longitude: null })
            }
          />
          <p className="studio-counter">{t("studio.brief.placeNote")}</p>
        </label>

        <div className="studio-field">
          <span className="studio-label">{t("studio.brief.location")}</span>
          <button
            type="button"
            className="studio-button studio-button-ghost"
            disabled={disabled || finding || !hasPlace}
            onClick={() => void checkOnMap()}
          >
            {finding ? t("studio.brief.searching") : t("studio.brief.checkPin")}
          </button>
          <p className="studio-counter" style={{ textAlign: "left" }}>
            {hasPlace
              ? t("studio.brief.checkPinHint")
              : t("studio.brief.typePlaceFirst")}
          </p>
          {hasPin && (
            <p className="studio-counter" style={{ textAlign: "left" }}>
              📍 {brief.latitude!.toFixed(6)}, {brief.longitude!.toFixed(6)}
            </p>
          )}
          {locationNote && (
            <p className="studio-note studio-note-warning" style={{ marginTop: 10 }}>
              {locationNote}
            </p>
          )}
        </div>

        <label className="studio-field">
          <span className="studio-label">{t("studio.brief.details")}</span>
          <textarea
            className="studio-textarea"
            value={brief.details}
            maxLength={2000}
            placeholder={t("studio.brief.detailsPlaceholder")}
            disabled={disabled}
            onChange={(event) => change({ details: event.target.value })}
          />
          <p className="studio-counter">
            {t("studio.brief.detailsCounter", { count: brief.details.trim().length })}
          </p>
        </label>
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.brief.lengthTitle")}</h2>
        <label className="studio-field">
          <span className="studio-label studio-length-value">
            <strong>{brief.targetSeconds}s</strong>
            <span>
              {brief.targetSeconds >= 60
                ? t("studio.brief.minutes", {
                    minutes: Math.floor(brief.targetSeconds / 60),
                    seconds: brief.targetSeconds % 60 ? `${brief.targetSeconds % 60}s` : "",
                  }).trim()
                : ""}
            </span>
          </span>
          <input
            className="studio-range"
            type="range"
            min={PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS}
            max={STUDIO_MAX_DURATION_SECONDS}
            step={1}
            value={brief.targetSeconds}
            disabled={disabled}
            aria-label={t("studio.brief.lengthAria")}
            onChange={(event) => change({ targetSeconds: Math.round(Number(event.target.value)) })}
          />
          <span className="studio-range-ends">
            <span>{PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS}s</span>
            <span>{STUDIO_MAX_DURATION_SECONDS}s</span>
          </span>
          <p className="studio-counter" style={{ textAlign: "left" }}>
            {t("studio.brief.lengthHint")}
          </p>
        </label>
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.brief.whereTitle")}</h2>
        <p className="studio-panel-hint">{t("studio.brief.whereHint")}</p>
        <div className="studio-chip-row" role="group" aria-label={t("studio.brief.channelsAria")}>
          {/* Travy is not offered in the studio for now: its export is made
              from server-held masters, which a phone-rendered request lacks. */}
          {FORM_PLATFORMS.filter((platform) => platform !== Platform.TravyApp).map((platform) => (
            <button
              key={platform}
              type="button"
              className="studio-chip"
              aria-pressed={brief.platforms.includes(platform)}
              disabled={disabled}
              onClick={() =>
                change({
                  platforms: brief.platforms.includes(platform)
                    ? brief.platforms.filter((entry) => entry !== platform)
                    : [...brief.platforms, platform],
                })
              }
            >
              <strong>{PLATFORM_LABELS[platform]}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">
          {requestId ? t("studio.brief.requestTitle") : t("studio.brief.saveTitle")}
        </h2>
        <p className="studio-panel-hint">
          {requestId
            ? t("studio.brief.savedHint")
            : t("studio.brief.createHint")}
        </p>

        {problems.length > 0 ? (
          <ul
            className="studio-note studio-note-warning"
            style={{ paddingLeft: 30, display: "grid", gap: 4 }}
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            className="studio-button studio-button-primary"
            disabled={disabled || saving || finding}
            onClick={() => void save()}
          >
            {saving
              ? t("studio.brief.saving")
              : requestId
                ? t("studio.brief.saveChanges")
                : t("studio.brief.create")}
          </button>
        )}

        {saved && !saveError && (
          <p className="studio-note studio-note-positive" style={{ marginTop: 12 }}>
            {t("studio.brief.saved")}
          </p>
        )}
        {saveError && (
          <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
            {saveError}
          </p>
        )}
      </section>

      <GoogleMapLocationPicker
        open={mapOpen}
        placeName={brief.placeName}
        initialCoordinates={pinForPicker}
        onClose={() => setMapOpen(false)}
        onConfirm={({ latitude, longitude }) => {
          change({
            latitude: Number(latitude.toFixed(6)),
            longitude: Number(longitude.toFixed(6)),
          });
          setLocationNote(null);
          setMapOpen(false);
        }}
      />
    </>
  );
}
