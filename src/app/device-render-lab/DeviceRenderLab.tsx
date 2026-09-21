"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  getNativeRenderCapabilities,
  observeDeviceRenderProgress,
  releaseDeviceRenderOutput,
  renderVideoFilesOnDevice,
} from "@/lib/mobile/deviceVideoRender";

async function durationOf(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  try {
    return await new Promise<number>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`Could not read ${file.name}`)), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        Number.isFinite(video.duration) && video.duration > 0
          ? resolve(video.duration)
          : reject(new Error(`Invalid duration: ${file.name}`));
      };
      video.onerror = () => { clearTimeout(timeout); reject(new Error(`Cannot decode ${file.name}`)); };
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export default function DeviceRenderLab() {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("Select one or two short MP4 clips to test the intermediate montage.");
  const [progress, setProgress] = useState(0);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => { if (outputPath) void releaseDeviceRenderOutput(outputPath); };
  }, [outputPath]);

  async function render() {
    setBusy(true);
    setProgress(0);
    let listener: Awaited<ReturnType<typeof observeDeviceRenderProgress>> | null = null;
    try {
      const capabilities = await getNativeRenderCapabilities();
      if (!capabilities || capabilities.nativePluginVersion < 3 || !Capacitor.isNativePlatform()) {
        throw new Error("Install an iOS or Android build with DeviceVideoRender v3 before testing.");
      }
      if (files.length < 1 || files.length > 2) throw new Error("Choose one or two clips.");
      const clips = await Promise.all(files.map(async (file) => ({
        file,
        startSeconds: 0,
        durationSeconds: Math.min(5, Math.max(0.1, (await durationOf(file)) - 0.1)),
      })));
      listener = await observeDeviceRenderProgress(setProgress);
      setMessage("Rendering the silent intermediate montage. A finished export must later add approved voice and selected music.");
      const result = await renderVideoFilesOnDevice(clips, 540, 960);
      setOutputPath(result.path);
      setMessage(`Intermediate montage: ${result.fileSizeBytes.toLocaleString()} bytes. Check motion and order. This is not a finished export.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await listener?.remove();
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6 text-slate-900">
      <h1 className="text-xl font-semibold">Phone montage test</h1>
      <p className="text-sm text-slate-600">Development-only intermediate test. The final video must contain approved speaking voice and selected background music. Nothing is uploaded or submitted here.</p>
      <input
        aria-label="Video clips"
        type="file"
        accept="video/mp4"
        multiple
        onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 2))}
      />
      <button
        type="button"
        disabled={busy || files.length === 0}
        onClick={() => void render()}
        className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? `Rendering ${progress}%` : "Render real clips on phone"}
      </button>
      <p role="status" className="text-sm">{message}</p>
      {outputPath && (
        <video
          key={outputPath}
          controls
          playsInline
          src={Capacitor.convertFileSrc(outputPath)}
          className="w-full rounded bg-black"
        />
      )}
    </main>
  );
}
