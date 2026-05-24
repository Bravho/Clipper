"""
RVC voice conversion server — runs on the Mac Mini.

Exposes:
  GET  /api/rvc/health                     — liveness check
  GET  /api/rvc/voices                     — list loaded voice models
  POST /api/rvc/convert                    — submit async job (returns job_id)
  GET  /api/rvc/jobs/{job_id}              — poll job status
  GET  /api/rvc/jobs/{job_id}/download     — download converted audio

  POST /convert                            — synchronous wrapper used by the
                                             web app browser (submits + waits +
                                             streams the audio back in one call)

Single-worker design: one job runs at a time; others wait in the queue.
Inference runs in a ThreadPoolExecutor so the async event loop stays free.

Start with:
    uvicorn server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

# ── Configuration ─────────────────────────────────────────────────────────────

MODEL_DIR = Path(os.getenv("RVC_MODEL_DIR", "./models"))
TMP_DIR   = Path(os.getenv("RVC_TMP_DIR",   "./tmp"))
MAX_AUDIO_SECONDS = 90
MAX_UPLOAD_BYTES  = 100 * 1024 * 1024  # 100 MB
SUPPORTED_FORMATS = {"wav", "mp3", "m4a", "webm", "flac", "ogg"}

logger = logging.getLogger("rvc_server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Voice model registry ───────────────────────────────────────────────────────
# Add a new entry here for each .pth / .index pair in MODEL_DIR.
# voice_id must match the filename stem of the .pth file.

VOICE_REGISTRY: Dict[str, dict] = {
    "thai_food_reviewer_male": {
        "id":                    "thai_food_reviewer_male",
        "name":                  "Thai Food Reviewer Male",
        "style":                 "energetic food review",
        "language":              "thai",
        "description":           "Energetic Thai male voice optimized for food reviews",
        "recommended_pitch_shift": 0,
        "tags":                  ["thai", "male", "energetic", "food", "review"],
        # Paths relative to MODEL_DIR
        "model_file":            "thai_food_reviewer_male.pth",
        "index_file":            "thai_food_reviewer_male.index",
    },
}

# ── Job store ─────────────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    QUEUED     = "queued"
    PROCESSING = "processing"
    COMPLETED  = "completed"
    FAILED     = "failed"


class JobRecord(BaseModel):
    job_id:      str
    status:      JobStatus
    voice_id:    str
    pitch_shift: int
    input_path:  Optional[str] = None
    output_path: Optional[str] = None
    error:       Optional[str] = None
    created_at:  datetime
    started_at:  Optional[datetime] = None
    finished_at: Optional[datetime] = None


_jobs: Dict[str, JobRecord] = {}
_job_queue: asyncio.Queue = asyncio.Queue()
_executor = ThreadPoolExecutor(max_workers=1)  # single worker

# ── RVC inference (runs in the thread pool) ────────────────────────────────────

def _run_rvc(input_path: str, output_path: str, voice_id: str, pitch_shift: int) -> None:
    """
    Blocking call to the RVC inference engine.
    Runs inside ThreadPoolExecutor — must not use asyncio primitives.

    Plug your actual RVC library here.
    This example uses rvc-python (pip install rvc-python).
    """
    voice = VOICE_REGISTRY[voice_id]
    model_path = str(MODEL_DIR / voice["model_file"])
    index_path = str(MODEL_DIR / voice["index_file"])

    # ── rvc-python integration ─────────────────────────────────────────────────
    from rvc_python.infer import RVCInference  # type: ignore[import]

    rvc = RVCInference(device="mps")           # "mps" for Apple Silicon
    rvc.load_model(model_path, index_path)
    rvc.infer_file(
        input_path,
        output_path,
        f0_up_key=pitch_shift,
        f0_method="rmvpe",                     # best quality on Mac Mini
    )
    # ── end rvc-python ─────────────────────────────────────────────────────────


# ── Background worker ─────────────────────────────────────────────────────────

async def _worker() -> None:
    """Single-worker coroutine — processes jobs from the queue one at a time."""
    while True:
        job_id: str = await _job_queue.get()
        job = _jobs.get(job_id)
        if job is None:
            _job_queue.task_done()
            continue

        job.status     = JobStatus.PROCESSING
        job.started_at = datetime.now(timezone.utc)
        logger.info("Processing job %s (voice=%s pitch=%d)", job_id, job.voice_id, job.pitch_shift)

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                _executor,
                _run_rvc,
                job.input_path,
                job.output_path,
                job.voice_id,
                job.pitch_shift,
            )
            job.status = JobStatus.COMPLETED
            logger.info("Job %s completed → %s", job_id, job.output_path)
        except Exception as exc:
            job.status = JobStatus.FAILED
            job.error  = str(exc)
            logger.exception("Job %s failed", job_id)
        finally:
            job.finished_at = datetime.now(timezone.utc)
            _job_queue.task_done()


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    worker_task = asyncio.create_task(_worker())
    logger.info("RVC server ready | models=%s | tmp=%s", MODEL_DIR, TMP_DIR)
    yield
    worker_task.cancel()
    _executor.shutdown(wait=False)
    # Clean up temp files older than this session
    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR, ignore_errors=True)


# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="RVC Voice Conversion Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _require_job(job_id: str) -> JobRecord:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


async def _save_upload(upload: UploadFile) -> Path:
    """Save the uploaded file to a temp location and return its path."""
    suffix = Path(upload.filename or "audio.wav").suffix.lower()
    if suffix.lstrip(".") not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{suffix}'. Allowed: {SUPPORTED_FORMATS}"
        )
    tmp_path = TMP_DIR / f"{uuid.uuid4()}_input{suffix}"
    async with aiofiles.open(tmp_path, "wb") as f:
        while chunk := await upload.read(1024 * 1024):  # 1 MB chunks
            await f.write(chunk)
    return tmp_path


def _output_path_for(job_id: str, fmt: str) -> Path:
    return TMP_DIR / f"{job_id}_output.{fmt}"


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/api/rvc/health")
async def health():
    """Liveness check."""
    return {
        "ok":               True,
        "service":          "rvc_server",
        "device":           "mps",
        "queue_size":       _job_queue.qsize(),
        "available_voices": len(VOICE_REGISTRY),
    }


@app.get("/api/rvc/voices")
async def voices() -> List[dict]:
    """Return all registered voice models (metadata only, no file paths)."""
    return [
        {k: v for k, v in entry.items() if k not in {"model_file", "index_file"}}
        for entry in VOICE_REGISTRY.values()
    ]


@app.post("/api/rvc/convert", status_code=202)
async def submit_job(
    audio:         UploadFile = File(...),
    voice_id:      str        = Form(...),
    pitch_shift:   int        = Form(0),
    output_format: str        = Form("wav"),
):
    """Submit a voice conversion job and return a job_id immediately."""
    if voice_id not in VOICE_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice_id '{voice_id}'. "
                   f"Available: {list(VOICE_REGISTRY)}"
        )
    if output_format not in {"wav", "mp3"}:
        raise HTTPException(status_code=400, detail="output_format must be 'wav' or 'mp3'")

    input_path  = await _save_upload(audio)
    job_id      = str(uuid.uuid4())
    output_path = _output_path_for(job_id, output_format)

    job = JobRecord(
        job_id      = job_id,
        status      = JobStatus.QUEUED,
        voice_id    = voice_id,
        pitch_shift = pitch_shift,
        input_path  = str(input_path),
        output_path = str(output_path),
        created_at  = datetime.now(timezone.utc),
    )
    _jobs[job_id] = job
    await _job_queue.put(job_id)

    logger.info(
        "Queued job %s (voice=%s pitch=%d queue_size=%d)",
        job_id, voice_id, pitch_shift, _job_queue.qsize()
    )
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/rvc/jobs/{job_id}")
async def job_status(job_id: str):
    """Poll the status of a submitted job."""
    return _require_job(job_id).model_dump()


@app.get("/api/rvc/jobs/{job_id}/download")
async def download_result(job_id: str):
    """Download the converted audio once the job is completed."""
    job = _require_job(job_id)
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail=f"Job is '{job.status}', not completed yet"
        )
    output_path = Path(job.output_path)
    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Output file missing")

    return FileResponse(
        path        = str(output_path),
        media_type  = "audio/wav",
        filename    = f"converted_{job_id}.wav",
    )


# ── Synchronous wrapper for browser use ───────────────────────────────────────

@app.post("/convert")
async def convert_sync(
    audio:       UploadFile = File(...),
    voice_id:    str        = Form(...),
    pitch_shift: int        = Form(0),
):
    """
    Synchronous convert endpoint used by the web app browser.

    Submits the job, polls internally, then streams the converted audio
    back in the response — so the browser receives audio bytes directly
    without having to implement its own polling.

    Called by VoiceRecordingPanel.tsx → handleConvert().
    """
    if voice_id not in VOICE_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice_id '{voice_id}'. Available: {list(VOICE_REGISTRY)}"
        )

    input_path  = await _save_upload(audio)
    job_id      = str(uuid.uuid4())
    output_path = _output_path_for(job_id, "wav")

    job = JobRecord(
        job_id      = job_id,
        status      = JobStatus.QUEUED,
        voice_id    = voice_id,
        pitch_shift = pitch_shift,
        input_path  = str(input_path),
        output_path = str(output_path),
        created_at  = datetime.now(timezone.utc),
    )
    _jobs[job_id] = job
    await _job_queue.put(job_id)

    # Poll until complete (runs in the same async context — the worker is on a different task)
    poll_interval = 1.5  # seconds
    timeout       = 300  # seconds
    elapsed       = 0.0

    while elapsed < timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        current = _jobs[job_id]

        if current.status == JobStatus.COMPLETED:
            audio_bytes = Path(current.output_path).read_bytes()
            return Response(
                content      = audio_bytes,
                media_type   = "audio/wav",
                headers      = {"Content-Disposition": f'attachment; filename="converted_{job_id}.wav"'},
            )

        if current.status == JobStatus.FAILED:
            raise HTTPException(
                status_code = 500,
                detail      = f"Voice conversion failed: {current.error}",
            )

    raise HTTPException(status_code=504, detail="Voice conversion timed out")
