import { Suspense } from "react";
import { AvatarWorkspace } from "@/features/ad-lab/AvatarWorkspace";

export default function AdLabAvatarPage() {
  return (
    <Suspense>
      <AvatarWorkspace />
    </Suspense>
  );
}
