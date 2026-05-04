import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep, PIPELINE_STEP_LABELS } from "@/domain/enums/VideoGenerationStep";
import { RequestStatus } from "@/domain/enums/RequestStatus";

export const metadata: Metadata = { title: "AI Pipeline — Staff" };

const STATUS_CONFIG: Record<VideoGenerationJobStatus, { label: string; color: string; border: string }> = {
  [VideoGenerationJobStatus.Active]:   { label: "Active",   color: "bg-blue-100 text-blue-700",   border: "border-blue-200" },
  [VideoGenerationJobStatus.Failed]:   { label: "Failed",   color: "bg-orange-100 text-orange-700", border: "border-orange-300" },
  [VideoGenerationJobStatus.Complete]: { label: "Complete", color: "bg-green-100 text-green-700",  border: "border-green-200" },
};

export default async function StaffPipelinePage() {
  await requireRole(Role.Editor, Role.Admin);

  // Load all editing requests and check for pipeline jobs
  const editingRequests = await clipRequestRepository.findByStatus([
    RequestStatus.Editing,
    RequestStatus.ScheduledForPublishing,
    RequestStatus.Published,
  ]);

  const rows = (
    await Promise.all(
      editingRequests.map(async (req) => {
        const job = await videoGenerationJobRepository.findByRequestId(req.id);
        return job ? { req, job } : null;
      })
    )
  ).filter(Boolean) as { req: (typeof editingRequests)[0]; job: Awaited<ReturnType<typeof videoGenerationJobRepository.findByRequestId>> }[];

  const failed   = rows.filter((r) => r.job!.status === VideoGenerationJobStatus.Failed);
  const active   = rows.filter((r) => r.job!.status === VideoGenerationJobStatus.Active);
  const complete = rows.filter((r) => r.job!.status === VideoGenerationJobStatus.Complete);

  function PipelineRow({ req, job }: (typeof rows)[0]) {
    if (!job) return null;
    const cfg = STATUS_CONFIG[job.status];
    const stepLabel = PIPELINE_STEP_LABELS[job.currentStep];
    const failedStepLabel = job.failedAtStep ? PIPELINE_STEP_LABELS[job.failedAtStep] : null;

    return (
      <div className={`rounded-lg border bg-white p-5 ${cfg.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900 truncate">{req.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.color}`}>
                {cfg.label}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Step: <strong>{stepLabel}</strong>
              {failedStepLabel && (
                <span className="ml-2 text-orange-600">
                  · Failed at: {failedStepLabel}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400">
              Job ID: <code className="font-mono">{job.id}</code>
            </p>
          </div>
          <a
            href={`/staff/requests/${req.id}/pipeline`}
            className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white ${
              job.status === VideoGenerationJobStatus.Failed
                ? "bg-orange-600 hover:bg-orange-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {job.status === VideoGenerationJobStatus.Failed ? "Retry →" : "Open Pipeline →"}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Video Pipeline</h1>
        <p className="mt-1 text-sm text-slate-500">
          All requests with an active or completed AI video pipeline.
        </p>
      </div>

      {/* Failed — needs attention first */}
      {failed.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-800">Failed — needs retry</h2>
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
              {failed.length}
            </span>
          </div>
          <div className="space-y-3">
            {failed.map(({ req, job }) => (
              <PipelineRow key={req.id} req={req} job={job} />
            ))}
          </div>
        </section>
      )}

      {/* Active */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">In Progress</h2>
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {active.length}
          </span>
        </div>
        {active.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
            <p className="text-sm text-slate-400">No pipelines currently in progress.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(({ req, job }) => (
              <PipelineRow key={req.id} req={req} job={job} />
            ))}
          </div>
        )}
      </section>

      {/* Complete */}
      {complete.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-800">Completed</h2>
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              {complete.length}
            </span>
          </div>
          <div className="space-y-3">
            {complete.map(({ req, job }) => (
              <PipelineRow key={req.id} req={req} job={job} />
            ))}
          </div>
        </section>
      )}

      {rows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-500 font-medium">No pipeline jobs yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Open an editing request and click &quot;Start AI Pipeline&quot; to begin.
          </p>
        </div>
      )}
    </div>
  );
}
