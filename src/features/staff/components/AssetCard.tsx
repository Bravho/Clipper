"use client";

import { useState, useRef, useEffect } from "react";

interface AssetCardProps {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  thumbnailUrl: string;
  hasStorageKey: boolean;
}

export function AssetCard({
  id,
  fileName,
  mimeType,
  fileSizeBytes,
  thumbnailUrl,
  hasStorageKey,
}: AssetCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Handle the case where the image error fires before React hydration.
  // After mount, check if the img element already failed to load.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setThumbFailed(true);
    }
  }, []);

  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  const sizeMb = Math.round((fileSizeBytes / 1024 / 1024) * 10) / 10;

  const showThumb = !!thumbnailUrl && !thumbFailed;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* Thumbnail area */}
      <div className="relative flex h-36 w-full items-center justify-center bg-slate-100">
        {showThumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={thumbnailUrl}
            alt={fileName}
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        )}

        {!showThumb && (
          <div className="flex flex-col items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              {isVideo ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M4 8a2 2 0 012-2h9a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"
                />
              ) : isImage ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              )}
            </svg>
          </div>
        )}

        {/* Video badge */}
        {isVideo && (
          <div className="absolute bottom-2 left-2">
            <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white">
              Video
            </span>
          </div>
        )}
      </div>

      {/* Meta + download */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{fileName}</p>
          <p className="text-xs text-slate-400">
            {isVideo ? "video" : isImage ? "image" : "file"} · {sizeMb} MB
          </p>
        </div>
        {hasStorageKey ? (
          <a
            href={`/api/staff/assets/${id}/download`}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Download
          </a>
        ) : (
          <span className="text-xs text-slate-400">Pending</span>
        )}
      </div>
    </div>
  );
}
