import { PublishingLink } from "@/domain/models/PublishingLink";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";

interface DeliveryLinksProps {
  links: PublishingLink[];
}

/**
 * Renders the published/delivered links for a completed clip request.
 *
 * TODO: Staff/Admin — when publishing automation is added, this section
 *   will be populated automatically via social media API webhooks.
 *   Staff will no longer need to manually enter links.
 */
export function DeliveryLinks({ links }: DeliveryLinksProps) {
  if (links.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Publishing links will appear here once your clip has been posted.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium text-slate-700">
              {PLATFORM_LABELS[link.platform] ?? link.platform}
            </p>
            <p className="text-xs text-slate-400">
              Published{" "}
              {link.publishedAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            View →
          </a>
        </div>
      ))}
      <p className="text-xs text-slate-400 mt-1">
        You may repost or share these links on your own channels at no cost.
      </p>
    </div>
  );
}
