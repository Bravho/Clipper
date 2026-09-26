import { redirect } from "next/navigation";
import { studioPath } from "@/config/routes";

/**
 * The old tester-only lab address. The studio now lives at /studio for every
 * requester; this keeps bookmarks, old links and in-app history working.
 * (The retired lab page is kept in `_to_delete/studio-lab-gate/`.)
 */
export default async function DeviceRenderLabRedirect({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  redirect(studioPath(request ?? null));
}
