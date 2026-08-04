import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import {
  managementContentRepository,
  managementPublicationRepository,
} from "@/repositories";
import { managementConnectionService } from "@/services/management/ManagementConnectionService";
import { spacesPublicUrl } from "@/lib/spaces";
import { SOCIAL_PLATFORM_LABELS } from "@/services/social-publishing/types";
import { ManagementPublicationTargetStatus } from "@/domain/enums/ManagementStatus";
import type { ManagementContentItem } from "@/domain/models/ManagementContent";
import {
  PostsManager,
  type ManagedPost,
} from "@/features/management/components/PostsManager";

export const dynamic = "force-dynamic";

/**
 * "จัดการโพสต์" — manage the posts a user has sent to their channels.
 *
 * One row PER CHANNEL (per publication target), because that is the unit a
 * business thinks in: "my restaurant video on Facebook", "…on TikTok". Each row
 * shows the video thumbnail, the channel, the post name, the date and the
 * status, plus a link to the live post.
 *
 * Edit and delete are offered ONLY on a still-SCHEDULED post — the provider (and
 * the platforms) refuse to change or remove a post once it is live, so a
 * published post is intentionally view-only. History stays readable after access
 * expires; this page reads, it never charges.
 */
export default async function ManagementPostsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();

  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  if (!isManagementEnabledFor(user)) notFound();

  const [publications, connections] = await Promise.all([
    managementPublicationRepository.findByUserId(user.id),
    managementConnectionService.list(user.id),
  ]);

  // Resolve display data once: content items (name + thumbnail) and connection
  // account names, keyed for O(1) lookup while flattening targets.
  const contentIds = Array.from(
    new Set(publications.map((p) => p.managementContentId))
  );
  const contentItems = await Promise.all(
    contentIds.map((id) => managementContentRepository.findById(id))
  );
  const contentById = new Map<string, ManagementContentItem>();
  for (const item of contentItems) if (item) contentById.set(item.id, item);

  const connectionById = new Map(connections.map((c) => [c.id, c]));

  const targetLists = await Promise.all(
    publications.map((p) => managementPublicationRepository.findTargets(p.id))
  );

  const posts: ManagedPost[] = [];
  publications.forEach((pub, i) => {
    const content = contentById.get(pub.managementContentId);
    const thumbnailUrl = content?.thumbnailStorageKey
      ? spacesPublicUrl(content.thumbnailStorageKey)
      : null;
    const postName = content?.title ?? "Untitled video";

    for (const target of targetLists[i]) {
      const conn = connectionById.get(target.socialConnectionId);
      const date =
        target.publishedAt ?? target.scheduledAt ?? pub.scheduledAt ?? pub.createdAt;

      posts.push({
        targetId: target.id,
        publicationId: pub.id,
        platform: target.platform,
        platformLabel:
          SOCIAL_PLATFORM_LABELS[
            target.platform as keyof typeof SOCIAL_PLATFORM_LABELS
          ] ?? target.platform,
        accountName: conn?.accountName ?? conn?.accountUsername ?? null,
        postName,
        thumbnailUrl,
        dateIso: date ? date.toISOString() : null,
        status: target.status,
        publishedUrl: target.publishedUrl,
        // Only a scheduled post can be edited/cancelled through the provider.
        canManage: target.status === ManagementPublicationTargetStatus.Scheduled,
        caption: target.caption ?? "",
        title: target.title,
        description: target.description,
        hashtags: target.hashtags ?? [],
      });
    }
  });

  // Newest first, so the most recent activity is at the top.
  posts.sort((a, b) => (b.dateIso ?? "").localeCompare(a.dateIso ?? ""));

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">จัดการโพสต์</h1>
        <p className="mt-1 text-sm text-slate-500">
          โพสต์ทั้งหมดของคุณในทุกช่องทาง · แก้ไขหรือลบได้เฉพาะโพสต์ที่ตั้งเวลาไว้และยังไม่ถูกเผยแพร่
        </p>
      </header>

      <PostsManager posts={posts} />
    </div>
  );
}
