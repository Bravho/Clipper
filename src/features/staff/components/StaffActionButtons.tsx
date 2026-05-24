"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { EffortClass, EFFORT_CLASS_LABELS } from "@/domain/enums/EffortClass";
import { Platform } from "@/domain/enums/Platform";

/**
 * StaffActionButtons — simplified workflow action buttons.
 *
 * Workflow:
 *   Submitted → "Accept & Start Editing" (requires effort class + due date)
 *   Editing   → "Submit for Production Review"
 *   ScheduledForPublishing → "Approve for Publishing" | "Return to Editing"
 *   Published → "Mark Delivered" | "Add Publishing Link"
 *   OnHold    → "Resume"
 *   Any active → "Put On Hold" | "Reject"
 */

type ModalType =
  | "accept-editing"
  | "submit-production"
  | "approve-publishing"
  | "return-editing"
  | "hold"
  | "reject"
  | "add-link"
  | "deliver";

const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: Platform.TikTok, label: "TikTok" },
  { value: Platform.Facebook, label: "Facebook" },
  { value: Platform.Instagram, label: "Instagram" },
  { value: Platform.YouTube, label: "YouTube" },
  { value: Platform.TventApp, label: "Tvent App" },
  { value: Platform.CDN, label: "CDN / Delivery Link" },
];

interface StaffActionButtonsProps {
  requestId: string;
  currentStatus: RequestStatus;
  isLockedByOther?: boolean;
}

export function StaffActionButtons({ requestId, currentStatus, isLockedByOther }: StaffActionButtonsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalType | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Accept & Start Editing fields
  const [effortClass, setEffortClass] = useState<EffortClass>(EffortClass.Standard);
  const [confirmedDate, setConfirmedDate] = useState("");
  const [acceptNote, setAcceptNote] = useState("");

  // General text input (hold reason, rejection reason, revision note, deliver note)
  const [textInput, setTextInput] = useState("");

  // Publishing link fields
  const [linkPlatform, setLinkPlatform] = useState(Platform.TikTok);
  const [linkUrl, setLinkUrl] = useState("");

  function openModal(type: ModalType) {
    setModal(type);
    setError(null);
    setTextInput("");
    setConfirmedDate("");
    setAcceptNote("");
    setLinkUrl("");
  }

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/staff/requests/${requestId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "An error occurred.");
    return json;
  }

  async function put(path: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/staff/requests/${requestId}/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "An error occurred.");
    return json;
  }

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setModal(null);
        router.push(pathname);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred.");
      }
    });
  }

  // ── Resume (On Hold → Submitted) ────────────────────────────────────────────
  async function handleResume() {
    run(() => post("resume", { note: "Resumed from hold. Returned to queue." }));
  }

  // ── Accept & Start Editing ──────────────────────────────────────────────────
  async function handleAcceptEditing() {
    if (!confirmedDate) { setError("Due date is required."); return; }
    if (!effortClass) { setError("Effort class is required."); return; }
    run(() => post("accept-editing", {
      confirmedDate,
      effortClass,
      note: acceptNote || undefined,
    }));
  }

  // ── Submit for Production Review ────────────────────────────────────────────
  async function handleSubmitProduction() {
    run(() => post("submit-production", { note: textInput || undefined }));
  }

  // ── Approve for Publishing ──────────────────────────────────────────────────
  async function handleApprovePublishing() {
    run(() => post("approve-publishing", { note: textInput || undefined }));
  }

  // ── Return to Editing ───────────────────────────────────────────────────────
  async function handleReturnEditing() {
    if (!textInput.trim()) { setError("A revision note is required."); return; }
    run(() => post("return-editing", { note: textInput }));
  }

  // ── Hold ────────────────────────────────────────────────────────────────────
  async function handleHold() {
    if (!textInput.trim()) { setError("Hold reason is required."); return; }
    run(() => post("hold", { holdReason: textInput }));
  }

  // ── Reject ──────────────────────────────────────────────────────────────────
  async function handleReject() {
    if (!textInput.trim()) { setError("Rejection reason is required."); return; }
    run(() => post("reject", { rejectionReason: textInput }));
  }

  // ── Add publishing link ─────────────────────────────────────────────────────
  async function handleAddLink() {
    if (!linkUrl.trim()) { setError("URL is required."); return; }
    run(() => put("publish", { platform: linkPlatform, url: linkUrl }));
  }

  // ── Mark Delivered ──────────────────────────────────────────────────────────
  async function handleDeliver() {
    run(() => post("deliver", { note: textInput || undefined }));
  }

  // ── Render nothing for truly terminal statuses or when locked ───────────────
  if (
    currentStatus === RequestStatus.Delivered ||
    currentStatus === RequestStatus.Draft
  ) {
    return null;
  }

  if (isLockedByOther) {
    return (
      <p className="text-sm text-slate-400">
        Actions unavailable — request is locked by another editor.
      </p>
    );
  }

  // ── Tomorrow's date as minimum for due date picker ──────────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <>
      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">

        {/* Submitted → Accept & Start Editing */}
        {currentStatus === RequestStatus.Submitted && (
          <button
            onClick={() => openModal("accept-editing")}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Accept &amp; Start Editing
          </button>
        )}

        {/* Rejected → Re-accept & Start Editing */}
        {currentStatus === RequestStatus.Rejected && (
          <button
            onClick={() => openModal("accept-editing")}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Re-accept &amp; Start Editing
          </button>
        )}

        {/* Editing → Submit for Production Review */}
        {currentStatus === RequestStatus.Editing && (
          <button
            onClick={() => openModal("submit-production")}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Submit for Production Review
          </button>
        )}

        {/* ScheduledForPublishing → Approve / Return */}
        {currentStatus === RequestStatus.ScheduledForPublishing && (
          <>
            <button
              onClick={() => openModal("approve-publishing")}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Approve for Publishing
            </button>
            <button
              onClick={() => openModal("return-editing")}
              className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
            >
              Return to Editing
            </button>
          </>
        )}

        {/* Published → Mark Delivered + Add Link */}
        {currentStatus === RequestStatus.Published && (
          <>
            <button
              onClick={() => openModal("deliver")}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Mark Delivered
            </button>
            <button
              onClick={() => openModal("add-link")}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add Publishing Link
            </button>
          </>
        )}

        {/* On Hold → Resume */}
        {currentStatus === RequestStatus.OnHold && (
          <button
            onClick={handleResume}
            disabled={isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Resume (Return to Queue)
          </button>
        )}

        {/* Universal: Hold and Reject */}
        {currentStatus !== RequestStatus.OnHold &&
          currentStatus !== RequestStatus.Published && (
          <button
            onClick={() => openModal("hold")}
            className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
          >
            Put On Hold
          </button>
        )}
        {currentStatus !== RequestStatus.Published && (
          <button
            onClick={() => openModal("reject")}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Reject Request
          </button>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">

            {/* Accept & Start Editing */}
            {modal === "accept-editing" && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Accept &amp; Start Editing</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Set the effort class and confirm a due date. The requester will see
                  the due date immediately after you accept.
                </p>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600">
                      Effort Class <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={effortClass}
                      onChange={(e) => setEffortClass(e.target.value as EffortClass)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {Object.values(EffortClass).map((ec) => (
                        <option key={ec} value={ec}>{EFFORT_CLASS_LABELS[ec]}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-400">
                      Simple = 1 day · Standard = 2 days · Complex = 3 days
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600">
                      Confirmed Due Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      min={minDate}
                      value={confirmedDate}
                      onChange={(e) => setConfirmedDate(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      This date is shown to the requester immediately.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600">
                      Internal Note (optional)
                    </label>
                    <textarea
                      value={acceptNote}
                      onChange={(e) => setAcceptNote(e.target.value)}
                      rows={2}
                      placeholder="Any notes for this acceptance..."
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Submit for Production Review */}
            {modal === "submit-production" && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Submit for Production Review</h3>
                <p className="mt-1 text-sm text-slate-500">
                  This marks editing as complete and sends the clip for admin review before publishing.
                </p>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  placeholder="Optional note about the completed editing..."
                  className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </>
            )}

            {/* Approve for Publishing */}
            {modal === "approve-publishing" && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Approve for Publishing</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Approves this clip for publishing. Staff will then add publishing links and deliver to the requester.
                </p>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={2}
                  placeholder="Optional approval note..."
                  className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </>
            )}

            {/* Return to Editing */}
            {modal === "return-editing" && (
              <>
                <h3 className="text-lg font-semibold text-amber-800">Return to Editing</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Send this clip back to the editor for revisions. A revision note is required.
                </p>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  placeholder="Describe what needs to be revised..."
                  className="mt-4 w-full rounded-md border border-amber-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </>
            )}

            {/* Hold */}
            {modal === "hold" && (
              <>
                <h3 className="text-lg font-semibold text-amber-800">Put On Hold</h3>
                <p className="mt-1 text-sm text-slate-500">
                  This reason will be shown to the requester.
                </p>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={4}
                  placeholder="Reason shown to requester (e.g. uploaded file is corrupt)..."
                  className="mt-4 w-full rounded-md border border-amber-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </>
            )}

            {/* Reject */}
            {modal === "reject" && (
              <>
                <h3 className="text-lg font-semibold text-red-700">Reject Request</h3>
                <p className="mt-1 text-sm text-slate-500">
                  This reason will be shown to the requester. This action cannot be undone.
                </p>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={4}
                  placeholder="Rejection reason shown to requester..."
                  className="mt-4 w-full rounded-md border border-red-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </>
            )}

            {/* Add publishing link */}
            {modal === "add-link" && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Add Publishing Link</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Enter the URL where the clip was published on this platform.
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600">Platform</label>
                    <select
                      value={linkPlatform}
                      onChange={(e) => setLinkPlatform(e.target.value as Platform)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {PLATFORM_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600">Published URL</label>
                    <input
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://..."
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Mark Delivered */}
            {modal === "deliver" && (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Mark as Delivered</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Confirm delivery to the requester. All publishing links should be recorded before this step.
                </p>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={2}
                  placeholder="Optional delivery note..."
                  className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => { setModal(null); setError(null); }}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  if (modal === "accept-editing") handleAcceptEditing();
                  else if (modal === "submit-production") handleSubmitProduction();
                  else if (modal === "approve-publishing") handleApprovePublishing();
                  else if (modal === "return-editing") handleReturnEditing();
                  else if (modal === "hold") handleHold();
                  else if (modal === "reject") handleReject();
                  else if (modal === "add-link") handleAddLink();
                  else if (modal === "deliver") handleDeliver();
                }}
                className={`rounded-md px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${
                  modal === "reject"
                    ? "bg-red-600 hover:bg-red-700"
                    : modal === "hold" || modal === "return-editing"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : modal === "approve-publishing" || modal === "deliver"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {isPending ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
