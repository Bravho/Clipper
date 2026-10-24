import type { ReactNode } from "react";
import type { ClipRequest } from "@/domain/models/ClipRequest";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { DeviceRenderAttempt } from "@/domain/models/DeviceRenderAttempt";
import type {
  StoryboardScene,
  ScenePlan,
  VideoGenerationJob,
  VideoGenerationStepHistoryEntry,
} from "@/domain/models/VideoGenerationJob";
import { PIPELINE_STEP_LABELS, VideoGenerationStep as S } from "@/domain/enums/VideoGenerationStep";
import { STUDIO_ACTIONS } from "@/config/studioEvents";
import { ELEVENLABS_VOICES } from "@/config/elevenLabsVoices";
import { findMusicTrack } from "@/config/backgroundMusic";
import { getTemplate } from "@/config/motionTemplates";
import { textGraphicChoiceOf } from "@/services/TextGraphicsService";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import {
  captionedOutputs,
  deriveLatestStep,
  factsFromJob,
  journeySteps,
  type RequestJourneyExtras,
} from "@/services/admin/AdminRequestJourneyService";
import { StudioStepBadge } from "./StudioStepBadge";

/**
 * Admin request detail: the request's studio journey, step by step, read only
 * from what the pipeline already stores (see AdminRequestJourneyService).
 *
 * MEDIA. Every audio/video player points at `/api/requests/[id]/stream`, the
 * existing authenticated proxy: it checks the session server-side (owner or
 * Admin only), checks the asset belongs to the request, and streams from the
 * private bucket by storage key with `Cache-Control: private`. No public
 * `storageUrl` is ever put on this page. Players use preload="none" so opening
 * the page downloads nothing until the admin presses play.
 */

interface Props {
  request: ClipRequest;
  job: VideoGenerationJob | null;
  history: VideoGenerationStepHistoryEntry[];
  attempts: DeviceRenderAttempt[];
  assets: UploadedAsset[];
  extras: RequestJourneyExtras;
}

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: REPORTING_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function duration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function streamUrl(requestId: string, assetId: string): string {
  return `/api/requests/${encodeURIComponent(requestId)}/stream?assetId=${encodeURIComponent(assetId)}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-36 shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-gray-800">{children}</dd>
    </div>
  );
}

function Step({
  title,
  at,
  reached,
  children,
}: {
  title: string;
  at: Date | null;
  reached: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="relative pl-7">
      <span
        className={`absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 ${
          reached ? "border-green-600 bg-green-500" : "border-gray-300 bg-white"
        }`}
        aria-hidden
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={`text-sm font-semibold ${reached ? "text-gray-900" : "text-gray-400"}`}>
          {title}
        </h3>
        <span className="text-xs text-gray-500">{reached ? fmt(at) : "not reached"}</span>
      </div>
      {children && <dl className="mt-2 space-y-1.5">{children}</dl>}
    </li>
  );
}

/** A player only when the asset row exists for THIS request (the stream route checks again). */
function MediaPlayer({
  kind,
  requestId,
  assetId,
  assets,
}: {
  kind: "audio" | "video";
  requestId: string;
  assetId: string;
  assets: UploadedAsset[];
}) {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) {
    return <span className="text-xs text-gray-400">File record not found ({assetId.slice(0, 8)}…)</span>;
  }
  const src = streamUrl(requestId, assetId);
  return kind === "audio" ? (
    <audio controls preload="none" src={src} className="w-full max-w-md" />
  ) : (
    <video
      controls
      preload="none"
      playsInline
      src={src}
      className="max-h-80 w-auto max-w-full rounded border border-gray-200 bg-black"
    />
  );
}

export function RequestJourneyTimeline({ request, job, history, attempts, assets, extras }: Props) {
  const downloads = extras.studioActions.filter((a) => a.action === "video_downloaded");
  const transfers = extras.channelItems;
  const publishedTargets = transfers.flatMap((i) => i.targets).filter((t) => t.status === "published");
  const publishedAt = publishedTargets
    .map((t) => t.publishedAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const transferredAt = transfers
    .map((i) => i.transferredAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const facts = factsFromJob({
    request,
    job,
    history,
    downloadedAt: downloads.length ? downloads[downloads.length - 1].at : null,
    transferredAt,
    publishedAt: publishedAt ?? (publishedTargets.length ? transferredAt : null),
  });
  const latest = deriveLatestStep(facts);
  const steps = new Map(journeySteps(facts).map((s) => [s.key, s]));
  const st = (key: Parameters<typeof steps.get>[0]) => steps.get(key)!;

  const storyboard =
    parseJson<StoryboardScene[]>(job?.approvedStoryboard ?? null) ??
    parseJson<StoryboardScene[]>(job?.storyboard ?? null);
  const storyboardIsApproved = !!job?.approvedStoryboard;
  const scenePlan =
    parseJson<ScenePlan[]>(job?.approvedScenePlan ?? null) ?? parseJson<ScenePlan[]>(job?.scenePlan ?? null);
  const script = job?.approvedScriptThai ?? job?.scriptThai ?? null;
  const voice = job ? ELEVENLABS_VOICES.find((v) => v.id === job.rvcVoiceModel) : undefined;
  const voiceMakes = history.filter((h) => h.step === S.GeneratingVoice).length;
  const music = job?.selectedMusicTrack;
  const musicLabel = music ? (findMusicTrack(music)?.label ?? (music === "none" ? "No music" : music)) : null;
  const template = job?.selectedMotionTemplate ? getTemplate(job.selectedMotionTemplate) : null;
  const textStyle = job ? textGraphicChoiceOf(job) : null;
  const outputs = captionedOutputs(job);

  // Render timing from the step history: first render step → main video ready.
  const firstAt = (steps: string[]) =>
    history.filter((h) => steps.includes(h.step)).map((h) => new Date(h.createdAt).getTime()).sort((a, b) => a - b)[0] ?? null;
  const renderStart = firstAt([S.GeneratingBaseVideo, S.MergingScenes, S.ComposingFinalVideo, S.GeneratingOverlay]);
  const renderEnd = firstAt([S.AwaitingOverlayApproval]);
  const framingStart = firstAt([S.GeneratingAdditionalRatios]);
  const framingEnd = firstAt([S.AwaitingDistributionReview, S.Complete]);

  const madeOnPhone = (assetId: string) => attempts.some((a) => a.resultAssetId === assetId);
  const failedAttempts = attempts.filter((a) => a.state === "failed");

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Studio Journey</h2>
        <StudioStepBadge step={latest} />
      </div>

      {job?.currentStep === S.Failed && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Pipeline failed
          {job.failedAtStep ? ` at “${PIPELINE_STEP_LABELS[job.failedAtStep] ?? job.failedAtStep}”` : ""} ·{" "}
          {fmt(job.stepStartedAt)}
        </p>
      )}
      {!job && (
        <p className="mb-4 text-sm text-gray-500">No studio job yet — the requester has not gone past the brief.</p>
      )}

      <ol className="space-y-6 border-l border-gray-100">
        <Step title="Brief saved" at={st("brief").at} reached>
          <Row label="Submitted">{fmt(request.submittedAt)}</Row>
          <Row label="Photos & clips">
            {assets.filter((a) => a.assetType === "image" || a.assetType === "video").length} uploaded
          </Row>
        </Step>

        <Step title="Storyboard (scenes)" at={st("storyboarded").at} reached={st("storyboarded").reached}>
          {storyboard?.length ? (
            <>
              <Row label="Scenes">
                {storyboard.length} {storyboardIsApproved ? "(approved version)" : "(generated, not approved)"}
              </Row>
              <Row label="Approved">
                {st("storyboard_approved").reached ? fmt(st("storyboard_approved").at) : "not yet"}
                {job?.contentApprovedBy ? ` · by ${job.contentApprovedBy.slice(0, 8)}…` : ""}
              </Row>
              <ol className="ml-36 list-decimal space-y-1 pl-5 text-sm text-gray-700">
                {storyboard.map((scene, i) => (
                  <li key={i}>
                    {scene.summary}
                    {scene.roughDurationHint ? <span className="text-gray-400"> · {scene.roughDurationHint}</span> : null}
                    {scene.assetIndexes?.length ? (
                      <span className="text-gray-400"> · media #{scene.assetIndexes.map((n) => n + 1).join(", #")}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            st("storyboarded").reached && <Row label="Scenes">No storyboard stored (legacy job)</Row>
          )}
        </Step>

        <Step title="Script & voice" at={st("voiced").at} reached={st("voiced").reached}>
          {job && (
            <>
              <Row label="Voice">{voice ? `${voice.name} (${voice.label})` : job.rvcVoiceModel || "—"}</Row>
              <Row label="Duration">
                {job.voiceDurationSeconds != null ? `${job.voiceDurationSeconds.toFixed(1)}s` : "—"}
              </Row>
              <Row label="Voice makes">{voiceMakes || "—"}</Row>
              <Row label="Approved">
                {st("voice_approved").reached ? fmt(st("voice_approved").at) : "not yet"}
              </Row>
              {script && (
                <Row label="Script">
                  <details>
                    <summary className="cursor-pointer text-blue-600">
                      {job.approvedScriptThai ? "Approved script" : "Draft script"} ({script.length} chars)
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700">{script}</p>
                  </details>
                </Row>
              )}
              {job.processedVoiceAssetId && (
                <Row label="Audio">
                  <MediaPlayer kind="audio" requestId={request.id} assetId={job.processedVoiceAssetId} assets={assets} />
                </Row>
              )}
            </>
          )}
        </Step>

        <Step title="Sound & look (music, template, text style)" at={st("render_started").at} reached={st("render_started").reached}>
          {job && (
            <>
              <Row label="Music">{musicLabel ?? "not chosen"}</Row>
              <Row label="Template">{template ? template.name : "not chosen"}</Row>
              <Row label="Text style">{textStyle ?? "—"}</Row>
              <Row label="Subtitles">{job.subtitleLanguages?.length ? job.subtitleLanguages.join(", ") : "—"}</Row>
              {scenePlan?.length ? (
                <Row label="Scene design">
                  {scenePlan.length} scenes ·{" "}
                  {scenePlan.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0).toFixed(1)}s
                  {job.approvedScenePlan ? " (approved)" : " (draft)"}
                </Row>
              ) : null}
            </>
          )}
        </Step>

        <Step title="Render (main video)" at={st("rendered").at} reached={st("rendered").reached || st("render_started").reached}>
          {job && (st("render_started").reached || attempts.length > 0) && (
            <>
              <Row label="Where">
                {request.renderLocation === "device" ? "Phone (device render)" : "Server"}
                {attempts.length ? ` · ${attempts.length} phone attempt${attempts.length > 1 ? "s" : ""}` : ""}
              </Row>
              <Row label="Took">{duration(renderStart && renderEnd ? renderEnd - renderStart : null)}</Row>
              <Row label="Server render">
                {job.renderState ?? "—"}
                {job.renderStep ? ` · ${job.renderStep}` : ""}
                {job.renderProgress != null ? ` · ${job.renderProgress}%` : ""}
              </Row>
              {failedAttempts.length > 0 && (
                <Row label="Phone errors">
                  <ul className="space-y-1 text-red-700">
                    {failedAttempts.slice(0, 5).map((a) => (
                      <li key={a.id}>
                        {fmt(a.updatedAt)} · {a.ratio} · {a.platform ?? "?"} {a.appVersion ?? ""} ·{" "}
                        {a.error ??
                          (typeof a.result?.errorLog === "string" ? String(a.result.errorLog).slice(0, 300) : "failed")}
                      </li>
                    ))}
                  </ul>
                </Row>
              )}
              {attempts.length > 0 && (
                <Row label="Phone attempts">
                  <details>
                    <summary className="cursor-pointer text-blue-600">Show all</summary>
                    <table className="mt-1 w-full text-xs">
                      <thead className="text-left text-gray-500">
                        <tr>
                          <th className="pr-2">Started</th>
                          <th className="pr-2">Ratio</th>
                          <th className="pr-2">Stage</th>
                          <th className="pr-2">Device</th>
                          <th className="pr-2">State</th>
                          <th>Took</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((a) => (
                          <tr key={a.id} className="border-t border-gray-100">
                            <td className="pr-2">{fmt(a.createdAt)}</td>
                            <td className="pr-2">{a.ratio}</td>
                            <td className="pr-2">{a.stage}</td>
                            <td className="pr-2">
                              {a.platform ?? "?"} {a.appVersion ?? ""}
                            </td>
                            <td className="pr-2">
                              {a.state}
                              {a.progressPercent != null && a.state !== "completed" ? ` (${a.progressPercent}%)` : ""}
                            </td>
                            <td>{duration(new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </Row>
              )}
            </>
          )}
        </Step>

        <Step title="Framing / channel shapes" at={st("framed").at} reached={st("framed").reached}>
          {outputs.length > 0 && (
            <>
              <Row label="Shapes">{outputs.map((o) => o.ratio).join(", ")}</Row>
              {framingStart && <Row label="Took">{duration(framingEnd ? framingEnd - framingStart : null)}</Row>}
            </>
          )}
        </Step>

        <Step title="Finished" at={st("finished").at} reached={st("finished").reached}>
          {outputs.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {outputs.map((o) => (
                <div key={o.ratio} className="space-y-1">
                  <p className="text-xs font-medium text-gray-600">
                    {o.ratio} · {madeOnPhone(o.assetId) ? "made on phone" : "made on server"}
                  </p>
                  <MediaPlayer kind="video" requestId={request.id} assetId={o.assetId} assets={assets} />
                </div>
              ))}
            </div>
          )}
          {request.videosExpireAt && <Row label="Videos expire">{fmt(request.videosExpireAt)}</Row>}
        </Step>

        <Step title="Download" at={st("downloaded").at} reached={st("downloaded").reached}>
          <Row label="Download unlocked">{request.downloadUnlocked ? "Yes (paid)" : "No (free / locked)"}</Row>
          {extras.studioEventsAvailable ? (
            downloads.length > 0 ? (
              <Row label="Downloads">
                {downloads.length} · first {fmt(downloads[0].at)} · last {fmt(downloads[downloads.length - 1].at)}
              </Row>
            ) : (
              <Row label="Downloads">None recorded by the app</Row>
            )
          ) : (
            <Row label="Downloads">Not trackable here (studio_events table missing)</Row>
          )}
        </Step>

        <Step title="Channel Management" at={st("transferred").at} reached={st("transferred").reached}>
          {transfers.map((item) => (
            <div key={item.id} className="rounded-lg border border-gray-100 p-2">
              <Row label="Sent">
                {fmt(item.transferredAt)} · {item.title || "(untitled)"} · {item.status}
                {item.removedAt ? ` · removed ${fmt(item.removedAt)}` : ""}
              </Row>
              {item.targets.map((t, i) => (
                <Row key={i} label={t.platform}>
                  {t.status}
                  {t.publishedAt ? ` · ${fmt(t.publishedAt)}` : t.scheduledAt ? ` · scheduled ${fmt(t.scheduledAt)}` : ""}
                  {t.publishedUrl ? (
                    <>
                      {" · "}
                      <a href={t.publishedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        post ↗
                      </a>
                    </>
                  ) : null}
                  {t.error ? <span className="text-red-700"> · {t.error}</span> : null}
                </Row>
              ))}
            </div>
          ))}
        </Step>

        <Step title="Published" at={st("published").at} reached={st("published").reached}>
          {(job?.publishingDrafts ?? [])
            .filter((d) => d.status && d.status !== "pending")
            .map((d, i) => (
              <Row key={i} label={`${d.platform} (studio)`}>
                {d.status}
                {d.url ? (
                  <>
                    {" · "}
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      post ↗
                    </a>
                  </>
                ) : null}
                {d.error ? <span className="text-red-700"> · {d.error}</span> : null}
              </Row>
            ))}
        </Step>
      </ol>

      {history.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-blue-600">Pipeline step log ({history.length})</summary>
          <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
            {history.map((h) => (
              <li key={h.id}>
                {fmt(h.createdAt)} · {PIPELINE_STEP_LABELS[h.step as S] ?? h.step}
                {h.sceneIndex != null ? ` (scene ${h.sceneIndex + 1})` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {extras.studioActions.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-blue-600">
            Studio clicks from the app ({extras.studioActions.length})
          </summary>
          <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
            {extras.studioActions.map((a, i) => (
              <li key={i}>
                {fmt(a.at)} · {(STUDIO_ACTIONS as Record<string, { label: string }>)[a.action]?.label ?? a.action}
                {a.surface ? ` · ${a.surface}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-4 text-xs text-gray-400">Times in Asia/Bangkok (UTC+7).</p>
    </section>
  );
}
