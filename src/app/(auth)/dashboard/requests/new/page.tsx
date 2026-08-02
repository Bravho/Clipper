import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { creditService } from "@/services/CreditService";
import { clipRequestService } from "@/services/ClipRequestService";
import { uploadedAssetRepository } from "@/repositories";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { PackageSelector } from "@/features/requests/components/PackageSelector";
import type { ResumeData } from "@/features/requests/components/PackageSelector";
import { getServerI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "คำขอใหม่ — RClipper" };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { t } = getServerI18n();
  const pageStartedAt = performance.now();
  const timings: Record<string, number> = {};
  const timed = async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      timings[label] = Math.round(performance.now() - startedAt);
    }
  };

  const user = await timed("auth", () => requireRole(Role.Requester));
  const { edit: editId } = await searchParams;
  const [balance, trialAvailable] = await Promise.all([
    timed("creditBalance", () => creditService.getBalance(user.id)),
    timed("trialAvailable", () => clipRequestService.isFirstRequest(user.id)),
  ]);

  // Resume flow: when opened as ?edit=<draftId> from the dashboard, load the
  // owned Draft and its already-uploaded source files so the form can continue
  // where a failed upload left off instead of starting a new request.
  let resume: ResumeData | undefined;
  if (editId) {
    let draft: Awaited<ReturnType<typeof clipRequestService.getOwnedRequest>> | null = null;
    try {
      draft = await timed("resumeDraft", () =>
        clipRequestService.getOwnedRequest(editId, user.id)
      );
    } catch {
      // Not found / not owned → fall through to a fresh form.
      draft = null;
    }

    // Already submitted (and therefore already charged): don't re-enter a
    // chargeable submit flow — send the user to view the live request instead.
    // redirect() must sit outside the try/catch (it throws NEXT_REDIRECT).
    if (draft && draft.status !== RequestStatus.Draft) {
      redirect(requestDetailPath(draft.id));
    }

    if (draft) {
      const assets = await timed("resumeAssets", () =>
        uploadedAssetRepository.findByRequestId(editId)
      );
      resume = {
        requestId: draft.id,
        initialValues: {
          title: draft.title,
          placeName: draft.placeName,
          latitude: draft.latitude,
          longitude: draft.longitude,
          description: draft.description,
          targetAudience: draft.targetAudience,
          targetPlatforms: draft.targetPlatforms,
          durationSeconds: draft.durationSeconds,
        },
        uploadedAssets: assets
          .filter(
            (a) =>
              a.uploadStatus === AssetUploadStatus.Uploaded &&
              (a.assetType === AssetType.Image || a.assetType === AssetType.Video)
          )
          .map((a) => ({
            fileName: a.fileName,
            fileSizeBytes: Number(a.fileSizeBytes) || 0,
            assetType: a.assetType === AssetType.Video ? "video" : "image",
            thumbnailUrl: a.thumbnailUrl || undefined,
            storageUrl: a.storageUrl || undefined,
          })),
      };
    }
  }

  if (process.env.NEW_REQUEST_PERF_LOG === "1") {
    console.info("[new-request timing]", {
      ...timings,
      totalDataLoad: Math.round(performance.now() - pageStartedAt),
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          {t("nav.dashboard")}
        </Link>
        <span>/</span>
        <Link href={ROUTES.REQUESTS} className="hover:text-slate-700">
          {t("sidebar.requests")}
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">{t("request.breadcrumbNew")}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          {resume ? "ดำเนินการคำขอต่อ" : t("request.newTitle")}
        </h1>
        <p className="mt-2 text-slate-500 text-sm">
          {resume
            ? "อัปโหลดไฟล์ที่เหลือให้ครบแล้วส่งคำขอ — ระบบจะอัปโหลดต่อจากจุดที่ค้างไว้"
            : t("request.newSubtitle")}
        </p>
      </div>

      <PackageSelector
        creditBalance={balance}
        trialAvailable={trialAvailable}
        resume={resume}
      />
    </div>
  );
}
