# JaiTTS Integration Analysis — RClipper Voice Pipeline

> **Corrections from v1:** (1) The voice recorder is the **requester** (business owner), not staff — it's embedded in `VideoApprovalPanel.tsx`. (2) JaiTTS runs **locally on the same Windows PC** as Next.js — no Mac Mini, no Cloudflare tunnel, just `localhost`.

---

## What JaiTTS Is

**JaiTTS-v1.0** ([arXiv:2604.27607](https://arxiv.org/abs/2604.27607), April 2026) is a Thai voice cloning TTS model built on the VoxCPM tokenizer-free autoregressive architecture. It handles Thai-English code-switching natively (critical for Thai social media scripts), achieves 1.94% CER (better than human ground truth of 1.98%), and beats commercial TTS flagships in 283/400 pairwise comparisons. Code: https://github.com/JTS-AI-Team/JaiTTS

---

## Current Voice Flow (What Actually Happens)

The voice step lives entirely inside `src/features/requests/components/VideoApprovalPanel.tsx` — the **requester's** dashboard panel. After approving the AI-generated video, the requester:

1. Reads the Thai script on screen
2. Records their own voice via browser mic (Web Audio API → PCM → WAV encoding, all in `VideoApprovalPanel`)
3. Browser-side RVC converts the recording
4. The converted WAV is uploaded to DO Spaces via `/api/requests/[id]/voice-recording/`
5. Confirmed via `/api/requests/[id]/voice-recording/confirm/` → `confirmVoiceRecording()`
6. Pipeline advances to `GeneratingAnimations`

The `VoiceRecordingPanel` in `features/staff/` and the staff routes at `/api/staff/requests/[id]/pipeline/voice-recording/` are a **parallel staff-side path** — but per your correction the primary/intended flow is the requester recording it themselves.

---

## Why Local on This PC (Not Mac Mini)

JaiTTS is a Python model that runs inference locally. Since Next.js already runs on this Windows machine:

- Call `http://localhost:PORT` — zero network latency, no tunnel, no external dependency
- The Mac Mini (used for RVC) is no longer involved at all
- One machine does everything: Next.js + JaiTTS Python server side by side

**Two deployment options for the Python side:**

**Option A — Long-running local Python HTTP server (recommended)**
```
npm run dev          ← Next.js on port 3000
python jaitts_server.py  ← JaiTTS FastAPI on port 7860 (start once, keeps model in memory)
```
Next.js calls `http://localhost:7860/synthesize`. Model loads once, stays warm. Fast on every request.

**Option B — Python subprocess per request**
Next.js spawns `python -c "import jaitts; ..."` for each synthesis. Simpler to set up, but re-loads the model every time (~slow).

Option A is better for production. For dev you can just run both processes in two terminal windows.

---

## New Pipeline Flow

```
AwaitingVideoApproval
  → Requester approves video
  → Server calls _runJaiTtsGeneration() asynchronously

GeneratingVoice  ← NEW (polling step, ~5–15 seconds locally)
  → JaiTTS synthesizes audio from approvedScriptThai
  → WAV uploaded to DO Spaces as processedVoiceAssetId

AwaitingVoiceApproval  ← REACTIVATED
  → Requester listens to AI-generated voice
  → Selects background music track
  → Clicks "Regenerate" (different voice style) or "Approve & Continue"
  → Advances to GeneratingAnimations
```

Because it runs on localhost, synthesis of a 15-second script is fast enough that `GeneratingVoice` could even be made **synchronous** (no polling) — just await inside `approveBaseVideoByRequester()`. Keep it async/polling for resilience.

---

## Files to Change

### 1. `src/domain/enums/VideoGenerationStep.ts`

Add `GeneratingVoice`, add it to `POLLING_STEPS`, update labels:

```typescript
// Step 3 — JaiTTS voice generation
GeneratingVoice         = "generating_voice",      // NEW — add to POLLING_STEPS
AwaitingVoiceApproval   = "awaiting_voice_approval", // reactivated

// Remove (or keep as legacy/unused):
// AwaitingVoiceRecording
// ProcessingVoice
```

```typescript
export const POLLING_STEPS: VideoGenerationStep[] = [
  VideoGenerationStep.AnalyzingContent,
  VideoGenerationStep.GeneratingBaseVideo,
  VideoGenerationStep.GeneratingVoice,        // ADD
  VideoGenerationStep.GeneratingAnimations,
  VideoGenerationStep.ComposingFinalVideo,
];
```

Updated labels:
```typescript
[VideoGenerationStep.GeneratingVoice]:       "กำลังสร้างเสียงพากย์...",
[VideoGenerationStep.AwaitingVoiceApproval]: "เสียงพากย์พร้อมตรวจสอบ",
```

---

### 2. `src/lib/ai/jaiTtsService.ts` — NEW FILE

Thin wrapper around the local JaiTTS HTTP server. Mirrors `klingService.ts`.

```typescript
// src/lib/ai/jaiTtsService.ts

import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { PutObjectCommand } from "@aws-sdk/client-s3";

export interface SynthesizeParams {
  text: string;         // Thai script (approvedScriptThai)
  voiceModel?: string;  // e.g. "female_th_warm", "male_th_energetic"
  speed?: number;
}

export interface JaiTtsJobStatus {
  status: "processing" | "complete" | "failed";
  audioUrl?: string;
  reason?: string;
}

/** Submit synthesis job. Returns job_id. */
export async function synthesize(params: SynthesizeParams): Promise<string> {
  const res = await fetch(`${AI_CONFIG.jaiTts.serverUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      voice_model: params.voiceModel ?? AI_CONFIG.jaiTts.defaultVoiceModel,
      speed: params.speed ?? 1.0,
      output_format: "wav",
    }),
  });
  if (!res.ok) throw new Error(`JaiTTS synthesize error: ${res.status}`);
  const { job_id } = await res.json();
  return job_id;
}

/** Poll for job status. */
export async function pollJobStatus(jobId: string): Promise<JaiTtsJobStatus> {
  const res = await fetch(`${AI_CONFIG.jaiTts.serverUrl}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`JaiTTS poll error: ${res.status}`);
  return res.json();
}

/** Download finished audio from local server, upload to DO Spaces. */
export async function downloadAndStore(
  audioUrl: string,
  userId: string,
  requestId: string
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`JaiTTS audio fetch error: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const storageKey = `voice_recordings/${userId}/${requestId}/jaitts_generated.wav`;
  await spacesClient.send(
    new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET!,
      Key: storageKey,
      Body: buffer,
      ContentType: "audio/wav",
      ACL: "public-read",
    })
  );

  return {
    storageKey,
    storageUrl: spacesPublicUrl(storageKey),
    fileSizeBytes: buffer.byteLength,
  };
}
```

---

### 3. `src/config/aiTools.ts`

Add `jaiTts` block:

```typescript
jaiTts: {
  // Runs on the same machine as Next.js — just localhost, no tunnel needed
  serverUrl: (process.env.JAI_TTS_SERVER_URL ?? "http://localhost:7860").trim(),
  defaultVoiceModel: (process.env.JAI_TTS_DEFAULT_VOICE_MODEL ?? "female_th_warm").trim(),
},
```

Add to `.env.example`:
```
# JaiTTS local server (runs on same machine as Next.js)
JAI_TTS_SERVER_URL=http://localhost:7860
JAI_TTS_DEFAULT_VOICE_MODEL=female_th_warm
```

---

### 4. `src/domain/models/VideoGenerationJob.ts`

Add `jaiTtsTaskId` field in the Step 3 voice section:

```typescript
// ── Step 3: JaiTTS voice generation ─────────────────────────────────────────
/** Async task ID returned by the local JaiTTS server for polling. */
jaiTtsTaskId: string | null;
// voiceRecordingAssetId and processedVoiceAssetId → will point to JaiTTS output WAV
// rvcVoiceModel → repurpose as jaiTtsVoiceModel (or rename in a DB migration)
```

---

### 5. `src/services/staff/VideoGenerationService.ts`

**Change `approveBaseVideoByRequester()` to fire JaiTTS instead of going to `AwaitingVoiceRecording`:**

```typescript
async approveBaseVideoByRequester(jobId: string, requesterId: string): Promise<VideoGenerationJob> {
  await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

  const updated = await videoGenerationJobRepository.update(jobId, {
    currentStep: VideoGenerationStep.GeneratingVoice,   // was: AwaitingVoiceRecording
    videoApprovedBy: requesterId,
  });

  this._runJaiTtsGeneration(updated).catch(async (err) => {
    console.error("[JaiTTS] Generation failed:", err);
    await videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Failed,
      currentStep: VideoGenerationStep.Failed,
      failedAtStep: VideoGenerationStep.GeneratingVoice,
    });
  });

  return this._getJob(jobId);
}
```

**New `_runJaiTtsGeneration()` private method:**

```typescript
private async _runJaiTtsGeneration(job: VideoGenerationJob): Promise<void> {
  const scriptThai = job.approvedScriptThai ?? job.scriptThai ?? "";
  if (!scriptThai) throw new Error("No approved Thai script for JaiTTS");

  const taskId = await jaiTtsService.synthesize({
    text: scriptThai,
    voiceModel: job.rvcVoiceModel || undefined,  // reuse field for voice selection
  });

  await videoGenerationJobRepository.update(job.id, { jaiTtsTaskId: taskId });
}
```

**New `checkVoiceReady()` polling method** (called by the status endpoint when step = `GeneratingVoice`):

```typescript
async checkVoiceReady(jobId: string): Promise<VideoGenerationJob> {
  const job = await this._getJob(jobId);
  if (job.currentStep !== VideoGenerationStep.GeneratingVoice) return job;
  if (!job.jaiTtsTaskId) return job;

  const status = await jaiTtsService.pollJobStatus(job.jaiTtsTaskId);

  if (status.status === "failed") {
    return videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Failed,
      currentStep: VideoGenerationStep.Failed,
      failedAtStep: VideoGenerationStep.GeneratingVoice,
    });
  }

  if (status.status !== "complete" || !status.audioUrl) return job;

  const request = await this._getClipRequestBasic(job.requestId);
  const { storageKey, storageUrl, fileSizeBytes } = await jaiTtsService.downloadAndStore(
    status.audioUrl,
    request.userId,
    job.requestId
  );

  const scheduledDeletionAt = new Date();
  scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

  const asset = await uploadedAssetRepository.create({
    requestId: job.requestId,
    userId: request.userId,
    fileName: "jaitts_generated.wav",
    assetType: AssetType.StaffVoiceRecording,
    fileSizeBytes,
    mimeType: "audio/wav",
    storageKey,
    storageUrl,
    thumbnailKey: "",
    thumbnailUrl: "",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt,
  });

  return videoGenerationJobRepository.update(jobId, {
    currentStep: VideoGenerationStep.AwaitingVoiceApproval,
    voiceRecordingAssetId: asset.id,
    processedVoiceAssetId: asset.id,
  });
}
```

**New `regenerateVoice()` method** — requester requests a different voice style:

```typescript
async regenerateVoice(jobId: string, requesterId: string, voiceModel?: string): Promise<VideoGenerationJob> {
  await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

  const updated = await videoGenerationJobRepository.update(jobId, {
    currentStep: VideoGenerationStep.GeneratingVoice,
    voiceRecordingAssetId: null,
    processedVoiceAssetId: null,
    jaiTtsTaskId: null,
    ...(voiceModel ? { rvcVoiceModel: voiceModel } : {}),
  });

  this._runJaiTtsGeneration(updated).catch(async (err) => {
    await videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Failed,
      currentStep: VideoGenerationStep.Failed,
      failedAtStep: VideoGenerationStep.GeneratingVoice,
    });
  });

  return updated;
}
```

**Update `retryPipeline()`** to handle `GeneratingVoice` as a retry case:

```typescript
case VideoGenerationStep.GeneratingVoice: {
  const updated = await videoGenerationJobRepository.update(jobId, {
    currentStep: VideoGenerationStep.GeneratingVoice,
    jaiTtsTaskId: null,
  });
  this._runJaiTtsGeneration(updated).catch(async (err) => {
    await videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Failed,
      currentStep: VideoGenerationStep.Failed,
      failedAtStep: VideoGenerationStep.GeneratingVoice,
    });
  });
  return updated;
}
```

---

### 6. Status polling route

In `src/app/api/requests/[id]/pipeline-status/route.ts`, add a `GeneratingVoice` polling branch:

```typescript
if (job.currentStep === VideoGenerationStep.GeneratingVoice) {
  job = await videoGenerationService.checkVoiceReady(job.id);
}
```

---

### 7. `src/features/requests/components/VideoApprovalPanel.tsx`

**Remove** the mic recording section (`RecorderState`, `startRecording`, `stopRecording`, `blobToBase64`, `encodePcmToWav`, RVC conversion logic, upload-to-voice-recording flow).

**Replace** the `isAwaitingVoiceRecording` branch with a new `isAwaitingVoiceApproval` branch that shows:

```
Step 3 — AI Voiceover Ready

[Audio player: jaitts_generated.wav]

Script used:
[approvedScriptThai text]

Voice style:
[Dropdown: Warm Female Thai | Energetic Male Thai | Soft Hospitality | ...]

[🔄 Try Different Voice]   [✓ Approve & Select Music →]
```

The music picker (already exists in `VoiceComparisonPanel`) should live here — the requester selects music at the same time they approve the voice.

---

### 8. New requester API endpoint

```
POST /api/requests/[id]/voice/regenerate
Body: { jobId, voiceModel? }
→ requireRole(Role.Requester) → videoGenerationService.regenerateVoice()
```

---

### 9. Remove requester mic-recording routes

These routes are no longer needed:

- `src/app/api/requests/[id]/voice-recording/route.ts`
- `src/app/api/requests/[id]/voice-recording/confirm/route.ts`

The staff-side equivalents can also be removed if the staff path is also being replaced:

- `src/app/api/staff/requests/[id]/pipeline/voice-recording/route.ts`
- `src/app/api/staff/requests/[id]/pipeline/voice-recording/confirm/route.ts`
- `src/app/api/rvc/jobs/[jobId]/route.ts`
- `src/app/api/rvc/jobs/[jobId]/download/route.ts`

---

## JaiTTS Local Server Setup (Windows PC)

```bash
# 1. Clone JaiTTS repo
git clone https://github.com/JTS-AI-Team/JaiTTS
cd JaiTTS

# 2. Install Python deps (use a venv)
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# 3. Run the HTTP server (keep this terminal open alongside npm run dev)
python server.py --port 7860
```

If JaiTTS doesn't ship a `server.py`, write a minimal FastAPI wrapper:

```python
# jaitts_server.py
from fastapi import FastAPI
from pydantic import BaseModel
import uuid, asyncio, jaitts   # adjust import to actual module name

app = FastAPI()
jobs = {}   # in-memory job store (fine for single-machine use)

class SynthRequest(BaseModel):
    text: str
    voice_model: str = "female_th_warm"
    speed: float = 1.0
    output_format: str = "wav"

@app.post("/synthesize")
async def synthesize(req: SynthRequest):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "processing"}
    asyncio.create_task(_run(job_id, req))
    return {"job_id": job_id}

async def _run(job_id: str, req: SynthRequest):
    try:
        out_path = f"/tmp/{job_id}.wav"
        # Replace with actual JaiTTS inference call:
        jaitts.synthesize(req.text, voice=req.voice_model, output=out_path)
        jobs[job_id] = {"status": "complete", "audio_url": f"http://localhost:7860/audio/{job_id}"}
    except Exception as e:
        jobs[job_id] = {"status": "failed", "reason": str(e)}

@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    return jobs.get(job_id, {"status": "failed", "reason": "not found"})

@app.get("/audio/{job_id}")
def serve_audio(job_id: str):
    from fastapi.responses import FileResponse
    return FileResponse(f"/tmp/{job_id}.wav", media_type="audio/wav")
```

```bash
uvicorn jaitts_server:app --port 7860
```

Add a `package.json` script to remind devs:
```json
"scripts": {
  "jaitts": "cd ../JaiTTS && .venv/Scripts/python jaitts_server.py --port 7860"
}
```

---

## Before/After Summary

| | Before (requester mic + RVC) | After (JaiTTS local) |
|---|---|---|
| Who generates voice | Requester records their own mic | JaiTTS AI — fully automated |
| Where it runs | Browser mic → RVC on Mac Mini | Python process on same PC as Next.js |
| External dependency | Mac Mini + Cloudflare tunnel | None — just `localhost:7860` |
| Requester experience | Read script, record, wait for conversion | Click "Approve Video" → receive AI audio to review |
| Staff involvement in voice | Upload/review path via staff routes | None needed |
| Re-generation | Must re-record physically | Click "Try Different Voice" |
| Network | Browser → Next.js → Mac Mini (tunnel) | Next.js → localhost (same machine) |

---

## Implementation Order

1. Set up JaiTTS Python server on this machine — confirm `localhost:7860` responds
2. Add `jaiTts` block to `AI_CONFIG` and `.env.example`
3. Create `src/lib/ai/jaiTtsService.ts`
4. Add `GeneratingVoice` to `VideoGenerationStep` + `POLLING_STEPS`
5. Add `jaiTtsTaskId` to `VideoGenerationJob` model + all repository implementations
6. Update `VideoGenerationService`: `approveBaseVideoByRequester()`, `_runJaiTtsGeneration()`, `checkVoiceReady()`, `regenerateVoice()`, `retryPipeline()`
7. Update status polling route for `GeneratingVoice`
8. Add `POST /api/requests/[id]/voice/regenerate` endpoint
9. Rework `VideoApprovalPanel` — strip mic/RVC code, add audio player + voice picker + regenerate button
10. Remove mic-recording and RVC proxy API routes
11. Update `ProductionPipeline.tsx` step mapping for `GeneratingVoice`

---

*arXiv:2604.27607 — JaiTTS: A Thai Voice Cloning Model (Apr 30, 2026) — https://github.com/JTS-AI-Team/JaiTTS*
