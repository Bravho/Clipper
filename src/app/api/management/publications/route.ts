import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementPublicationService,
  PublishNotEntitledError,
  PublicationValidationError,
} from "@/services/management/ManagementPublicationService";
import { managementPublicationRepository } from "@/repositories";
import { ManagementPublishMode } from "@/domain/enums/ManagementStatus";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * Publish composer endpoint.
 *
 * This creates a publication and submits it to the user's social channels. It is
 * NOT where money is taken — `/api/management/checkout` is the only paid
 * endpoint. When the user is not entitled, this route REFUSES with
 * `paymentRequired` so the composer can surface the package picker; it never
 * charges as a side effect.
 *
 * The schema carries no price, amount, entitlement or duration — only what to
 * publish and where. Entitlement is re-evaluated server-side inside the service.
 */
const targetSchema = z.object({
  socialConnectionId: z.string().uuid(),
  managementContentAssetId: z.string().uuid(),
  caption: z.string().max(5000).optional(),
  title: z.string().max(300).nullish(),
  description: z.string().max(5000).nullish(),
  hashtags: z.array(z.string().max(100)).max(60).optional(),
});

const bodySchema = z
  .object({
    contentId: z.string().uuid(),
    publishMode: z.nativeEnum(ManagementPublishMode),
    /** ISO 8601 UTC instant; required when publishMode is scheduled. */
    scheduledAt: z.string().datetime().nullish(),
    timezone: z.string().max(100).nullish(),
    targets: z.array(targetSchema).min(1).max(20),
  })
  .strict();

export async function POST(request: Request) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const { publication, targets } = await managementPublicationService.create(
      guard.user,
      {
        managementContentId: body.contentId,
        publishMode: body.publishMode,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        timezone: body.timezone ?? null,
        targets: body.targets.map((t) => ({
          socialConnectionId: t.socialConnectionId,
          managementContentAssetId: t.managementContentAssetId,
          caption: t.caption,
          title: t.title ?? null,
          description: t.description ?? null,
          hashtags: t.hashtags,
        })),
      }
    );

    return NextResponse.json(
      {
        publication: {
          id: publication.id,
          status: publication.status,
          publishMode: publication.publishMode,
          scheduledAt: publication.scheduledAt?.toISOString() ?? null,
          providerPostId: publication.providerPostId,
        },
        targets: targets.map((t) => ({
          id: t.id,
          socialConnectionId: t.socialConnectionId,
          platform: t.platform,
          status: t.status,
          errorCode: t.errorCode,
          publishedUrl: t.publishedUrl,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PublishNotEntitledError) {
      // A denial money can fix → 402 so the composer opens the package picker.
      if (err.reason === "payment_required" || err.reason === "access_expired") {
        return NextResponse.json(
          { error: "Publishing requires access.", reason: err.reason, paymentRequired: true },
          { status: 402 }
        );
      }
      // Not owner is indistinguishable from missing; the rest are 409s the user
      // cannot resolve by paying.
      const status = err.reason === "not_owner" || err.reason === "content_not_found" ? 404 : 409;
      return NextResponse.json({ error: "Publishing not available.", reason: err.reason }, { status });
    }
    if (err instanceof PublicationValidationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return managementErrorResponse("POST /api/management/publications", err);
  }
}

/**
 * GET /api/management/publications?contentId=…
 *
 * The publication history for one content item (or, without the filter, the
 * user's whole history). Readable after access expires — expiry blocks new
 * publishing, not viewing what already went out.
 */
export async function GET(request: Request) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const contentId = url.searchParams.get("contentId");

  try {
    const publications = contentId
      ? await managementPublicationRepository.findByContentId(contentId)
      : await managementPublicationRepository.findByUserId(guard.user.id);

    // findByContentId is not user-scoped, so drop anything not theirs.
    const owned = publications.filter((p) => p.userId === guard.user.id);

    const withTargets = await Promise.all(
      owned.map(async (p) => {
        const targets = await managementPublicationRepository.findTargets(p.id);
        return {
          id: p.id,
          managementContentId: p.managementContentId,
          status: p.status,
          publishMode: p.publishMode,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
          targets: targets.map((t) => ({
            id: t.id,
            platform: t.platform,
            status: t.status,
            errorCode: t.errorCode,
            publishedUrl: t.publishedUrl,
            publishedAt: t.publishedAt?.toISOString() ?? null,
          })),
        };
      })
    );

    return NextResponse.json({ publications: withTargets });
  } catch (err) {
    return managementErrorResponse("GET /api/management/publications", err);
  }
}
