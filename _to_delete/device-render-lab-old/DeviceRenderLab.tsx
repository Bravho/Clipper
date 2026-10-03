"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  getNativeRenderCapabilities, observeDeviceRenderProgress, releaseDeviceRenderOutput,
  renderAudioDraftOnDevice, renderVideoFilesOnDevice,
} from "@/lib/mobile/deviceVideoRender";

type Clip = { id: string; file: File; start: number; duration: number; length: number };
type Ratio = "9:16" | "16:9" | "1:1" | "4:5";
const sizes: Record<Ratio, [number, number]> = {
  "9:16": [540, 960], "16:9": [960, 540], "1:1": [720, 720], "4:5": [720, 900],
};

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
          ? resolve(video.duration) : reject(new Error(`Invalid duration: ${file.name}`));
      };
      video.onerror = () => { clearTimeout(timeout); reject(new Error(`Cannot decode ${file.name}`)); };
      video.src = url;
    });
  } finally {
    video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
  }
}

export default function DeviceRenderLab() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [voice, setVoice] = useState<File | null>(null);
  const [music, setMusic] = useState<File | null>(null);
  const [message, setMessage] = useState("Choose clips to start a local phone draft.");
  const [progress, setProgress] = useState(0);
  const [montagePath, setMontagePath] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const outputs = useRef({ montagePath, draftPath });
  outputs.current = { montagePath, draftPath };

  useEffect(() => () => {
    if (outputs.current.montagePath) void releaseDeviceRenderOutput(outputs.current.montagePath);
    if (outputs.current.draftPath) void releaseDeviceRenderOutput(outputs.current.draftPath);
  }, []);

  function invalidateMontage() {
    if (outputs.current.montagePath) void releaseDeviceRenderOutput(outputs.current.montagePath);
    if (outputs.current.draftPath) void releaseDeviceRenderOutput(outputs.current.draftPath);
    outputs.current = { montagePath: null, draftPath: null };
    setMontagePath(null); setDraftPath(null);
  }

  function invalidateDraft() {
    if (outputs.current.draftPath) void releaseDeviceRenderOutput(outputs.current.draftPath);
    outputs.current = { ...outputs.current, draftPath: null };
    setDraftPath(null);
  }

  async function chooseClips(files: FileList | null) {
    try {
      const next = await Promise.all(Array.from(files ?? []).slice(0, 10).map(async (file, i) => {
        const length = await durationOf(file);
        return { id: `${file.name}-${file.lastModified}-${i}`, file, start: 0,
          duration: Math.round(Math.min(5, Math.max(0.1, length - 0.1)) * 10) / 10, length };
      }));
      invalidateMontage();
      setClips(next);
      setMessage(`${next.length} clip(s) ready. Set their order and trims.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  function move(i: number, by: -1 | 1) {
    invalidateMontage();
    setClips((current) => {
      const j = i + by;
      if (j < 0 || j >= current.length) return current;
      const next = [...current]; [next[i], next[j]] = [next[j], next[i]]; return next;
    });
  }

  async function run(work: () => Promise<void>) {
    setBusy(true); setProgress(0);
    let listener: Awaited<ReturnType<typeof observeDeviceRenderProgress>> | null = null;
    try {
      const caps = await getNativeRenderCapabilities();
      if (!caps || caps.nativePluginVersion < 4 || !Capacitor.isNativePlatform())
        throw new Error("Install an iOS or Android build with DeviceVideoRender v4.");
      listener = await observeDeviceRenderProgress(setProgress);
      await work();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { await listener?.remove(); setBusy(false); }
  }

  function renderMontage() {
    void run(async () => {
      if (!clips.length) throw new Error("Choose at least one clip.");
      if (clips.some((c) => c.start < 0 || c.duration <= 0 || c.start + c.duration > c.length + 0.05))
        throw new Error("A clip trim exceeds its original duration.");
      setMessage("Joining moving clips on this phone; camera audio is removed.");
      const [width, height] = sizes[ratio];
      const result = await renderVideoFilesOnDevice(clips.map((c) => ({
        file: c.file, startSeconds: c.start, durationSeconds: c.duration,
      })), width, height);
      invalidateMontage();
      setMontagePath(result.path); setDraftPath(null);
      setMessage(`Silent montage ready (${(result.fileSizeBytes / 1e6).toFixed(1)} MB). Add a voice below.`);
    });
  }

  function renderDraft() {
    void run(async () => {
      if (!montagePath || !voice) throw new Error("Render a montage and choose a voice first.");
      setMessage("Mixing voice and selected music into a local MP4.");
      const result = await renderAudioDraftOnDevice(montagePath, voice, music ?? undefined);
      if (outputs.current.draftPath) void releaseDeviceRenderOutput(outputs.current.draftPath);
      setDraftPath(result.path);
      setMessage(`Audible draft ready (${(result.fileSizeBytes / 1e6).toFixed(1)} MB). Listen before continuing.`);
    });
  }

  const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const primary = "w-full rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-40";
  return <main className="mx-auto max-w-3xl space-y-5 bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
    <header className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Device render lab</p>
      <h1 className="text-2xl font-bold">Make a phone video draft</h1>
      <p className="text-sm text-slate-600">Original clips stay on this phone. This lab does not submit or publish a request.</p>
    </header>
    <section className={card} aria-labelledby="clips-heading">
      <h2 id="clips-heading" className="text-lg font-semibold">1 · Clips and framing</h2>
      <label className="mt-4 block text-sm">Choose up to 10 MP4 clips
        <input className="mt-2 block w-full" type="file" accept="video/mp4" multiple onChange={(e) => void chooseClips(e.target.files)} />
      </label>
      <label className="mt-4 block text-sm">Output shape
        <select value={ratio} onChange={(e) => { invalidateMontage(); setRatio(e.target.value as Ratio); }} className="mt-2 block w-full rounded-lg border p-2">
          <option value="9:16">9:16 · Reels and Shorts</option><option value="16:9">16:9 · Landscape</option>
          <option value="1:1">1:1 · Square</option><option value="4:5">4:5 · Portrait feed</option>
        </select>
      </label>
      <ol className="mt-4 space-y-3">{clips.map((clip, i) => <li key={clip.id} className="rounded-xl border bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">{i + 1}. {clip.file.name}</span>
          <span className="flex gap-1">
            <button type="button" aria-label={`Move ${clip.file.name} earlier`} disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded border px-2 py-1 disabled:opacity-30">↑</button>
            <button type="button" aria-label={`Move ${clip.file.name} later`} disabled={busy || i === clips.length - 1} onClick={() => move(i, 1)} className="rounded border px-2 py-1 disabled:opacity-30">↓</button>
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Original {clip.length.toFixed(1)}s · source audio removed</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <label>Start (s)<input type="number" min="0" step="0.1" value={clip.start} onChange={(e) => { invalidateMontage(); setClips((list) => list.map((c, j) => j === i ? { ...c, start: Number(e.target.value) } : c)); }} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label>Play for (s)<input type="number" min="0.1" step="0.1" value={clip.duration} onChange={(e) => { invalidateMontage(); setClips((list) => list.map((c, j) => j === i ? { ...c, duration: Number(e.target.value) } : c)); }} className="mt-1 w-full rounded-lg border p-2" /></label>
        </div>
      </li>)}</ol>
      <button type="button" disabled={busy || !clips.length} onClick={renderMontage} className={`${primary} mt-5`}>Render local montage</button>
    </section>
    <section className={card} aria-labelledby="audio-heading">
      <h2 id="audio-heading" className="text-lg font-semibold">2 · Speaking voice and music</h2>
      <p className="my-3 text-sm text-slate-600">Choose a test voice or a downloaded approved voice. The lab does not verify approval. Music is optional. The voice starts after a 0.6 second intro; music plays underneath at 30%.</p>
      <label className="block text-sm">Speaking voice (required)<input className="mt-2 block w-full" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-m4a" onChange={(e) => { invalidateDraft(); setVoice(e.target.files?.[0] ?? null); }} /></label>
      <label className="mt-4 block text-sm">Background music (optional)<input className="mt-2 block w-full" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-m4a" onChange={(e) => { invalidateDraft(); setMusic(e.target.files?.[0] ?? null); }} /></label>
      <button type="button" disabled={busy || !montagePath || !voice} onClick={renderDraft} className={`${primary} mt-5`}>Make audible MP4 draft</button>
    </section>
    <section className={card} aria-labelledby="review-heading">
      <h2 id="review-heading" className="text-lg font-semibold">3 · Review on phone</h2>
      {busy && <progress value={progress} max="100" className="mt-3 w-full" />}
      <p role="status" className="my-3 text-sm">{message}</p>
      {(draftPath || montagePath) && <video key={draftPath ?? montagePath} controls playsInline src={Capacitor.convertFileSrc((draftPath ?? montagePath)!)} className="w-full rounded-lg bg-black" />}
      <p className="mt-4 text-xs leading-relaxed text-slate-500">This is a draft. Image motion, scene transitions, voice normalization, music ducking, timed captions, graphics, job approval, and final upload remain to be implemented.</p>
    </section>
  </main>;
}
