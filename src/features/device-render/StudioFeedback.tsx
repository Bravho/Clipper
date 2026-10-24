"use client";

import { useEffect, useId, useState } from "react";

import type { MessageKey } from "@/i18n/messages";
import { useStudioT } from "./studioI18n";

/**
 * "How was this video?" — rate it and say what to improve, or report a
 * content problem.
 *
 * This is the studio's version of the old pipeline's `ReportAiContent`
 * (DistributionReviewPanel, Mac Mini era), which disappeared from the user's
 * view when the studio became the way to make a video. Same two jobs, same
 * endpoint (`/api/requests/[id]/report-ai-content` → `ai_content_reports`),
 * so every rating and report still lands on the admin Feedback page:
 *
 *   FEEDBACK — 1–5 stars, one topic to improve, optional details.
 *   REPORT   — the store-required way to flag AI content (unsafe, sexual,
 *              impersonation, copyright…), with optional details.
 *
 * The reason values are the API's enum exactly; the admin page labels them.
 * After sending, the card folds into a thank-you line (remembered on this
 * phone per request, best-effort) with "Send more", so it never nags.
 */

type ReportType = "feedback" | "safety";

const FEEDBACK_REASONS = [
  "video_quality",
  "scene_selection",
  "motion_direction",
  "audio_music",
  "subtitles",
  "aspect_ratio",
  "other_feedback",
] as const;

const SAFETY_REASONS = [
  "unsafe",
  "sexual",
  "violent",
  "hate",
  "privacy",
  "impersonation",
  "copyright",
  "misleading",
  "other",
] as const;

const MAX_DETAILS = 2000;

const sentKey = (requestId: string) => `rclipper.studio.feedback.${requestId}`;

function readSent(requestId: string): { type: ReportType; rating: number | null } | null {
  try {
    const raw = window.localStorage.getItem(sentKey(requestId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { type?: unknown; rating?: unknown };
    if (parsed.type !== "feedback" && parsed.type !== "safety") return null;
    return { type: parsed.type, rating: typeof parsed.rating === "number" ? parsed.rating : null };
  } catch {
    return null;
  }
}

function writeSent(requestId: string, value: { type: ReportType; rating: number | null }) {
  try {
    window.localStorage.setItem(sentKey(requestId), JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the thank-you still shows this visit.
  }
}

export function StudioFeedback({ requestId }: { requestId: string }) {
  const t = useStudioT();
  const detailsId = useId();
  const [type, setType] = useState<ReportType>("feedback");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [reason, setReason] = useState<string>("video_quality");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ type: ReportType; rating: number | null } | null>(null);

  useEffect(() => {
    setSent(readSent(requestId));
  }, [requestId]);

  const switchType = (next: ReportType) => {
    if (next === type) return;
    setType(next);
    setReason(next === "feedback" ? "video_quality" : "");
    setError(null);
  };

  const reasons = type === "feedback" ? FEEDBACK_REASONS : SAFETY_REASONS;
  const canSend =
    !sending && reason !== "" && (type === "safety" || rating > 0);
  const shown = hover || rating;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/report-ai-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: type,
          reason,
          rating: type === "feedback" ? rating : null,
          details: details.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(`report ${response.status}`);
      const done = { type, rating: type === "feedback" ? rating : null };
      writeSent(requestId, done);
      setSent(done);
      setDetails("");
    } catch {
      setError(t("studio.feedback.failed"));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <section className="studio-panel studio-feedback">
        <div className="studio-feedback-thanks" role="status">
          <span className="studio-feedback-thanks-mark" aria-hidden>
            ✓
          </span>
          <div>
            <p className="studio-feedback-thanks-title">
              {sent.type === "feedback"
                ? t("studio.feedback.thanksFeedback")
                : t("studio.feedback.thanksReport")}
            </p>
            {sent.type === "feedback" && sent.rating ? (
              <p className="studio-feedback-thanks-stars" aria-label={t("studio.feedback.star", { count: sent.rating })}>
                {"★".repeat(sent.rating)}
                <span>{"★".repeat(5 - sent.rating)}</span>
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="studio-feedback-link"
          onClick={() => {
            setSent(null);
            setRating(0);
          }}
        >
          {t("studio.feedback.sendAnother")}
        </button>
      </section>
    );
  }

  return (
    <section className="studio-panel studio-feedback" data-mode={type}>
      <h2 className="studio-panel-title">{t("studio.feedback.title")}</h2>
      <p className="studio-panel-hint">{t("studio.feedback.hint")}</p>

      <div className="studio-segment" role="tablist" aria-label={t("studio.feedback.title")}>
        <button
          type="button"
          role="tab"
          aria-selected={type === "feedback"}
          className="studio-segment-option"
          onClick={() => switchType("feedback")}
        >
          <span aria-hidden>★</span> {t("studio.feedback.tabFeedback")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={type === "safety"}
          className="studio-segment-option"
          data-tone="danger"
          onClick={() => switchType("safety")}
        >
          <span aria-hidden>⚑</span> {t("studio.feedback.tabReport")}
        </button>
      </div>

      {type === "feedback" && (
        <div className="studio-field">
          <span className="studio-label">{t("studio.feedback.ratingLabel")}</span>
          <div className="studio-stars" role="radiogroup" aria-label={t("studio.feedback.ratingLabel")} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={t("studio.feedback.star", { count: value })}
                className="studio-star"
                data-on={value <= shown}
                onMouseEnter={() => setHover(value)}
                onClick={() => setRating(value)}
              >
                ★
              </button>
            ))}
            <span className="studio-stars-word" aria-live="polite">
              {shown
                ? t(`studio.feedback.rating${shown}` as MessageKey)
                : t("studio.feedback.chooseRating")}
            </span>
          </div>
        </div>
      )}

      <div className="studio-field">
        <span className="studio-label">
          {type === "feedback" ? t("studio.feedback.topicLabel") : t("studio.feedback.reasonLabel")}
        </span>
        <div className="studio-chip-row" data-tone={type === "safety" ? "danger" : undefined}>
          {reasons.map((value) => (
            <button
              key={value}
              type="button"
              className="studio-chip studio-feedback-chip"
              aria-pressed={reason === value}
              onClick={() => setReason(value)}
            >
              {t(`studio.feedback.reason.${value}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      <label className="studio-field" htmlFor={detailsId}>
        <span className="studio-label">{t("studio.feedback.detailsLabel")}</span>
        <textarea
          id={detailsId}
          className="studio-textarea"
          value={details}
          maxLength={MAX_DETAILS}
          rows={3}
          placeholder={
            type === "feedback"
              ? t("studio.feedback.detailsPlaceholderFeedback")
              : t("studio.feedback.detailsPlaceholderReport")
          }
          onChange={(event) => setDetails(event.target.value)}
        />
        <p className="studio-counter">
          {details.length}/{MAX_DETAILS}
        </p>
      </label>

      {type === "safety" && (
        <p className="studio-note studio-note-danger" style={{ marginBottom: 12 }}>
          {t("studio.feedback.reportNote")}
        </p>
      )}

      {error && (
        <p className="studio-note studio-note-danger" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <button
        type="button"
        className={`studio-button ${type === "feedback" ? "studio-button-primary" : "studio-button-danger"}`}
        disabled={!canSend}
        onClick={() => void submit()}
      >
        {sending
          ? t("studio.feedback.sending")
          : type === "feedback"
            ? t("studio.feedback.sendFeedback")
            : t("studio.feedback.sendReport")}
      </button>
    </section>
  );
}
