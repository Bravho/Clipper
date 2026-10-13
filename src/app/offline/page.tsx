import type { Metadata } from "next";
import { OfflineMessage } from "./OfflineMessage";

export const metadata: Metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto max-w-md">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-3xl">
          📡
        </div>
        <OfflineMessage />
      </div>
    </div>
  );
}
