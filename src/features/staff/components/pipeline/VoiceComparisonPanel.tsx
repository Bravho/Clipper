"use client";

import { useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { Button } from "@/components/ui/Button";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  voiceRecording: UploadedAsset | null;
  processedVoice: UploadedAsset | null;
}

export function VoiceComparisonPanel({ requestId, job, voiceRecording, processedVoice }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Music picker state
  // Pre-select from the job's saved choice; null on the job means "requester chose no music" → "none"
  const [selectedTrack, setSelectedTrack] = useState<string | null>(job.selectedMusicTrack ?? "none");
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function handleTrackClick(trackId: string) {
    // Stop any preview currently playing
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setPlayingTrack(null);

    if (trackId === "none") {
      setSelectedTrack("none");
      return;
    }

    const track = BACKGROUND_MUSIC_TRACKS.find((t) => t.id === trackId)!;
    if (playingTrack !== trackId) {
      const audio = new Audio(track.url);
      audio.onended = () => setPlayingTrack(null);
      audio.play();
      audioRef.current = audio;
      setPlayingTrack(trackId);
    }
    setSelectedTrack(trackId);
  }

  async function callApi(action: "approve" | "reject") {
    setLoading(action);
    setError(null);
    try {
      const body: Record<string, unknown> = { jobId: job.id };
      if (action === "approve") body.selectedMusicTrack = selectedTrack === "none" ? null : selectedTrack;

      const res = await fetch(
        `/api/staff/requests/${requestId}/pipeline/voice/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error);
      audioRef.current?.pause();
      router.push(pathname);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Step 3 — Review Voice Conversion</h2>
      <p className="text-sm text-gray-500">
        ฟังเสียงที่แปลงผ่าน RVC แล้ว อนุมัติหากโทนและจังหวะเหมาะสม หรือบันทึกใหม่หากต้องการแก้ไข
      </p>

      {/* Voice comparison */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Original Recording
          </p>
          {voiceRecording ? (
            <audio src={voiceRecording.storageUrl} controls className="w-full" />
          ) : (
            <p className="text-sm text-gray-400">Not available</p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
            เสียงที่แปลงแล้ว (RVC)
          </p>
          {processedVoice ? (
            <audio src={processedVoice.storageUrl} controls className="w-full" />
          ) : (
            <p className="text-sm text-gray-400">Processing...</p>
          )}
        </div>
      </div>

      {/* Background music picker */}
      <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            เพลงพื้นหลัง
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            คลิกเพื่อฟังตัวอย่างและเลือกเพลง — เสียงพูดจะดังขึ้นอัตโนมัติเมื่อไม่มีการพูด
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {/* No-music option */}
          <button
            onClick={() => handleTrackClick("none")}
            className={[
              "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
              selectedTrack === "none"
                ? "border-gray-500 bg-gray-100 text-gray-800 font-medium"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50",
            ].join(" ")}
          >
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
              {selectedTrack === "none" ? (
                <svg className="w-4 h-4 text-gray-700" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                  <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 20v4M8 20h8" />
                </svg>
              )}
            </span>
            <span className="truncate">ไม่ใส่เพลง</span>
          </button>

          {BACKGROUND_MUSIC_TRACKS.map((track) => {
            const isSelected = selectedTrack === track.id;
            const isPlaying = playingTrack === track.id;
            return (
              <button
                key={track.id}
                onClick={() => handleTrackClick(track.id)}
                className={[
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                  isSelected
                    ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
                ].join(" ")}
              >
                <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                  {isPlaying ? (
                    <span className="flex gap-0.5 items-end h-4">
                      <span className="w-0.5 bg-blue-500 rounded-full animate-[bounce_0.6s_ease-in-out_infinite]" style={{ height: "60%" }} />
                      <span className="w-0.5 bg-blue-500 rounded-full animate-[bounce_0.6s_ease-in-out_0.1s_infinite]" style={{ height: "100%" }} />
                      <span className="w-0.5 bg-blue-500 rounded-full animate-[bounce_0.6s_ease-in-out_0.2s_infinite]" style={{ height: "40%" }} />
                    </span>
                  ) : isSelected ? (
                    <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{track.label}</span>
              </button>
            );
          })}
        </div>

        {selectedTrack === null && (
          <p className="text-xs text-amber-600 mt-1">กรุณาเลือกเพลง หรือเลือก &ldquo;ไม่ใส่เพลง&rdquo; ก่อนอนุมัติ</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button
          onClick={() => callApi("approve")}
          disabled={loading !== null || !processedVoice || selectedTrack === null}
          variant="primary"
        >
          {loading === "approve" ? "Approving..." : "Approve Voice & Music"}
        </Button>
        <Button
          onClick={() => callApi("reject")}
          disabled={loading !== null}
          variant="secondary"
        >
          {loading === "reject" ? "..." : "Re-record"}
        </Button>
      </div>
    </div>
  );
}
