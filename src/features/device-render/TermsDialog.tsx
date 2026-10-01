"use client";

import { useEffect, useRef } from "react";

import { ORIGINALS_KEPT_DAYS } from "@/config/localMedia";
import type { MessageKey } from "@/i18n/messages";
import { useStudioT } from "./studioI18n";

/**
 * The full terms behind the studio's one agreement box.
 *
 * The content is the web request form's old consent popup (NewRequestForm,
 * "ข้อกำหนดและหนังสือยินยอมสำหรับคำขอนี้"), carried over section by section
 * and put into all three catalogues (`studio.terms.*`). Two things differ, on
 * purpose (Tho, 1 Oct):
 *   - It is for READING only. There is no Accept / Decline: the box under the
 *     Submit button is the agreement, and the popup has just a close (×)
 *     button in its top-right corner (plus Escape and a tap outside).
 *   - Where the old text described the web flow (the Accept/Decline buttons,
 *     originals uploaded and deleted after ~90 days), it now says what the
 *     studio does: the box is ticked by hand, and the originals stay on the
 *     phone, kept in the app for ORIGINALS_KEPT_DAYS days.
 */

const SECTIONS: { title: MessageKey; body: MessageKey[]; list?: MessageKey[]; after?: MessageKey[] }[] = [
  { title: "studio.terms.s1.title", body: ["quota.consentClause", "studio.terms.s1.p2"] },
  { title: "studio.terms.s2.title", body: ["studio.terms.s2.p1", "studio.terms.s2.p2"] },
  { title: "studio.terms.s3.title", body: ["studio.terms.s3.p1", "studio.terms.s3.p2"] },
  {
    title: "studio.terms.s4.title",
    body: ["studio.terms.s4.p1"],
    list: ["studio.terms.s4.gemini", "studio.terms.s4.elevenlabs"],
    after: ["studio.terms.s4.p2"],
  },
  { title: "studio.terms.s5.title", body: ["studio.terms.s5.p1"] },
  { title: "studio.terms.s6.title", body: ["studio.terms.s6.p1"] },
];

export function TermsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useStudioT();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // The page behind must not scroll while the terms are being read.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  if (!open) return null;
  const vars = { days: ORIGINALS_KEPT_DAYS };

  return (
    <div className="studio-dialog-backdrop" onClick={onClose}>
      <div
        className="studio-dialog studio-terms-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-terms-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="studio-terms-head">
          <h2 id="studio-terms-title" className="studio-panel-title" style={{ margin: 0 }}>
            {t("studio.terms.title")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="studio-terms-close"
            aria-label={t("studio.terms.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="studio-terms-body">
          <p>{t("studio.terms.intro")}</p>
          {SECTIONS.map((section, index) => (
            <section key={section.title} className="studio-terms-section">
              <h3>
                {index + 1}. {t(section.title)}
              </h3>
              {section.body.map((key) => (
                <p key={key}>{t(key, vars)}</p>
              ))}
              {section.list && (
                <ol>
                  {section.list.map((key) => (
                    <li key={key}>{t(key, vars)}</li>
                  ))}
                </ol>
              )}
              {section.after?.map((key) => <p key={key}>{t(key, vars)}</p>)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
