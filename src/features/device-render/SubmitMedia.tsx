"use client";

import { useState } from "react";

import { useIsIosApp } from "@/lib/mobile/platform";

import { useStudioT } from "./studioI18n";
import { QuotaStatus, type StudioQuota } from "./QuotaPrompt";
import { TermsDialog } from "./TermsDialog";

/**
 * The submit step, under the media grid.
 *
 * WHY HERE AND NOT ON ITS OWN SCREEN. Submitting is the moment the material is
 * fixed, so it belongs next to the material: the last thing you see before
 * pressing it is exactly what you are sending.
 *
 * WHAT PRESSING IT DOES, SAID ON THE BUTTON'S DOORSTEP. It uses one video from
 * the quota, the originals stay on this phone, and what goes to RClipper is the
 * brief plus one small preview per item. The single agreement box mirrors the
 * web form's: the server requires the same three confirmations, and a phone is
 * no place to make someone tick three boxes that say one thing.
 */
export function SubmitMedia({
  hasRequest,
  submitted,
  problems,
  confirmed,
  submitting,
  progress,
  error,
  onConfirm,
  onSubmit,
  onGoToBrief,
  disabled,
  quota = null,
}: {
  /** The brief has been saved as a request. */
  hasRequest: boolean;
  submitted: boolean;
  problems: string[];
  confirmed: boolean;
  submitting: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  onConfirm: (value: boolean) => void;
  onSubmit: () => void;
  onGoToBrief: () => void;
  disabled: boolean;
  /** The account's allowance: a line under Submit, or the buy prompt when none is left. */
  quota?: StudioQuota | null;
}) {
  const t = useStudioT();
  const [termsOpen, setTermsOpen] = useState(false);
  const isIosApp = useIsIosApp();
  if (submitted) return null;

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
      {!hasRequest ? (
        <>
          <p className="studio-note studio-note-warning">
            {t("studio.submit.saveBriefFirst")}
          </p>
          <button type="button" className="studio-button studio-button-ghost" onClick={onGoToBrief}>
            {t("studio.submit.goToBrief")}
          </button>
        </>
      ) : (
        <>
          {problems.length > 0 && (
            <ul
              className="studio-note studio-note-warning"
              style={{ paddingLeft: 30, display: "grid", gap: 4, margin: 0 }}
            >
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
            <input
              type="checkbox"
              style={{ width: 22, height: 22, flexShrink: 0, marginTop: 1 }}
              checked={confirmed}
              disabled={disabled || submitting}
              onChange={(event) => onConfirm(event.target.checked)}
            />
            <span style={{ color: "var(--s-text-muted)" }}>
              {t("studio.submit.consent")}
            </span>
          </label>
          {/* Outside the label, so opening the terms never ticks the box. */}
          <button
            type="button"
            className={isIosApp ? "studio-terms-link studio-terms-link-ios" : "studio-terms-link"}
            onClick={() => setTermsOpen(true)}
          >
            {t("studio.terms.open")}
          </button>
          <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />

          <button
            type="button"
            className="studio-button studio-button-primary"
            disabled={disabled || submitting || !confirmed || problems.length > 0}
            onClick={onSubmit}
          >
            {submitting
              ? progress
                ? t("studio.submit.keeping", { done: progress.done, total: progress.total })
                : t("studio.submit.submitting")
              : t("studio.submit.submit")}
          </button>
          <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
            {t("studio.submit.note")}
          </p>
          <QuotaStatus quota={quota} />
        </>
      )}

      {error && <p className="studio-note studio-note-danger">{error}</p>}
    </div>
  );
}
