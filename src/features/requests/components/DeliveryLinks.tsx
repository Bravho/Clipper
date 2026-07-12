import { PublishingLink } from "@/domain/models/PublishingLink";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";

interface DeliveryLinksProps {
  links: PublishingLink[];
}

/**
 * Renders the links for a clip that has been FEATURED on one of RClipper's own
 * channels. RClipper does not publish the requester's clip to their channels on
 * their behalf — these links only appear when staff/admin choose to feature a
 * clip (a curation action).
 */
export function DeliveryLinks({ links }: DeliveryLinksProps) {
  if (links.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        This clip has not been featured on any RClipper channel.
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
        These are posts where RClipper has featured your clip on its own channels.
      </p>
    </div>
  );
}
