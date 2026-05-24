"""
RVC voice conversion client library.

Talks to the FastAPI RVC server running on the Mac Mini.
Supports both synchronous (blocking) and async (submit + poll) workflows.
"""

import logging
import time
from pathlib import Path
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)


# ── Exceptions ────────────────────────────────────────────────────────────────

class RVCError(Exception):
    """Base exception for all RVC client errors."""


class RVCServerError(RVCError):
    """HTTP error from the RVC server."""
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        super().__init__(f"RVC server error {status_code}: {detail}")


class RVCTimeoutError(RVCError):
    """Polling exceeded the allowed timeout."""


class RVCJobFailedError(RVCError):
    """Server accepted the job but conversion failed during processing."""
    def __init__(self, job_id: str, error: str):
        self.job_id = job_id
        super().__init__(f"Job {job_id} failed: {error}")


class RVCInvalidVoiceError(RVCError):
    """The requested voice_id does not exist on the server."""


# ── Client ────────────────────────────────────────────────────────────────────

class RVCClient:
    """
    Synchronous Python client for the RVC voice conversion server.

    Example:
        client = RVCClient("http://192.168.1.190:8000")
        result = client.convert_voice("input.wav", "thai_food_reviewer_male")
        print(result["output_path"])
    """

    def __init__(
        self,
        base_url: str,
        *,
        request_timeout: float = 30.0,
        poll_interval: float = 2.0,
    ):
        """
        Args:
            base_url: Root URL of the RVC server (no trailing slash).
            request_timeout: Seconds before a single HTTP request times out.
            poll_interval: Seconds between status polls when waiting for a job.
        """
        self.base_url = base_url.rstrip("/")
        self.poll_interval = poll_interval
        self._client = httpx.Client(timeout=request_timeout)

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    # ── Public API ─────────────────────────────────────────────────────────────

    def check_health(self) -> dict:
        """
        Verify the server is reachable and ready.

        Returns:
            {"ok": bool, "service": str, "device": str,
             "queue_size": int, "available_voices": int}

        Raises:
            RVCError: If the server is unreachable.
        """
        return self._get("/api/rvc/health")

    def list_voices(self) -> list[dict]:
        """
        Return all voice models available on the server.

        Returns:
            [{"id": str, "name": str, "language": str, ...}, ...]
        """
        return self._get("/api/rvc/voices")

    def convert_voice(
        self,
        audio_file: str | Path,
        voice_id: str,
        *,
        pitch_shift: int = 0,
        output_format: str = "wav",
        output_path: str | Path | None = None,
        timeout: float = 300.0,
        progress_callback: Optional[Callable[[str, dict], None]] = None,
    ) -> dict:
        """
        Submit a conversion job and block until it completes.

        Args:
            audio_file: Path to the input audio file.
            voice_id: Target voice model ID (from list_voices()).
            pitch_shift: Pitch adjustment in semitones (−12 to +12).
            output_format: Desired output format ("wav" or "mp3").
            output_path: Where to save the result. Defaults to
                         <audio_file_stem>_converted.<output_format>
                         in the same directory.
            timeout: Maximum seconds to wait before raising RVCTimeoutError.
            progress_callback: Optional callable(status: str, job: dict) called
                               each time the job status changes.

        Returns:
            {"job_id": str, "output_path": str, "status": "completed"}

        Raises:
            FileNotFoundError: If audio_file does not exist.
            RVCInvalidVoiceError: If voice_id is not available.
            RVCJobFailedError: If the server reports the job as failed.
            RVCTimeoutError: If the job does not complete within timeout.
        """
        audio_file = Path(audio_file)
        if not audio_file.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_file}")

        self._validate_voice_id(voice_id)

        job_id = self.convert_voice_async(
            audio_file, voice_id,
            pitch_shift=pitch_shift,
            output_format=output_format,
        )
        logger.info("Submitted job %s for voice %s", job_id, voice_id)

        job = self._poll_until_done(job_id, timeout=timeout, progress_callback=progress_callback)

        if output_path is None:
            output_path = audio_file.parent / f"{audio_file.stem}_converted.{output_format}"

        self.download_result(job_id, output_path)
        logger.info("Job %s completed → %s", job_id, output_path)
        return {"job_id": job_id, "output_path": str(output_path), "status": "completed"}

    def convert_voice_async(
        self,
        audio_file: str | Path,
        voice_id: str,
        *,
        pitch_shift: int = 0,
        output_format: str = "wav",
    ) -> str:
        """
        Submit a conversion job without waiting for the result.

        Returns:
            job_id string — use get_job_status() and download_result() later.

        Raises:
            FileNotFoundError: If audio_file does not exist.
            RVCInvalidVoiceError: If voice_id is not available.
        """
        audio_file = Path(audio_file)
        if not audio_file.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_file}")

        with open(audio_file, "rb") as f:
            resp = self._post_form(
                "/api/rvc/convert",
                data={
                    "voice_id": voice_id,
                    "pitch_shift": str(pitch_shift),
                    "output_format": output_format,
                },
                files={"audio": (audio_file.name, f, _mime_for(audio_file))},
            )

        return resp["job_id"]

    def get_job_status(self, job_id: str) -> dict:
        """
        Fetch the current status of a job.

        Returns:
            {"job_id": str, "status": str, "voice_id": str,
             "output_path": str|None, "error": str|None, ...}
        """
        return self._get(f"/api/rvc/jobs/{job_id}")

    def download_result(self, job_id: str, output_path: str | Path) -> Path:
        """
        Download the converted audio file once the job is completed.

        Args:
            job_id: Job identifier from convert_voice_async().
            output_path: Local path to write the audio file to.

        Returns:
            Path to the saved file.

        Raises:
            RVCError: If the job has not completed yet.
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            resp = self._client.get(f"{self.base_url}/api/rvc/jobs/{job_id}/download")
            _raise_for_status(resp)
        except httpx.HTTPError as exc:
            raise RVCError(f"Network error downloading result: {exc}") from exc

        output_path.write_bytes(resp.content)
        return output_path

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _poll_until_done(
        self,
        job_id: str,
        *,
        timeout: float,
        progress_callback: Optional[Callable[[str, dict], None]],
    ) -> dict:
        deadline = time.monotonic() + timeout
        last_status = None

        while True:
            if time.monotonic() > deadline:
                raise RVCTimeoutError(
                    f"Job {job_id} did not complete within {timeout:.0f}s"
                )

            job = self.get_job_status(job_id)
            status = job["status"]

            if status != last_status:
                logger.info("Job %s → %s", job_id, status)
                if progress_callback:
                    progress_callback(status, job)
                last_status = status

            if status == "completed":
                return job
            if status == "failed":
                raise RVCJobFailedError(job_id, job.get("error") or "unknown error")

            time.sleep(self.poll_interval)

    def _validate_voice_id(self, voice_id: str) -> None:
        voices = self.list_voices()
        ids = {v["id"] for v in voices}
        if voice_id not in ids:
            raise RVCInvalidVoiceError(
                f"Voice '{voice_id}' not found. Available: {sorted(ids)}"
            )

    def _get(self, path: str) -> dict | list:
        try:
            resp = self._client.get(f"{self.base_url}{path}")
            _raise_for_status(resp)
            return resp.json()
        except httpx.HTTPError as exc:
            raise RVCError(f"Network error: {exc}") from exc

    def _post_form(self, path: str, *, data: dict, files: dict) -> dict:
        try:
            resp = self._client.post(
                f"{self.base_url}{path}", data=data, files=files
            )
            _raise_for_status(resp)
            return resp.json()
        except httpx.HTTPError as exc:
            raise RVCError(f"Network error: {exc}") from exc


# ── Utilities ─────────────────────────────────────────────────────────────────

def _raise_for_status(resp: httpx.Response) -> None:
    if resp.is_error:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        raise RVCServerError(resp.status_code, detail)


def _mime_for(path: Path) -> str:
    return {
        ".wav":  "audio/wav",
        ".mp3":  "audio/mpeg",
        ".m4a":  "audio/mp4",
        ".webm": "audio/webm",
        ".flac": "audio/flac",
        ".ogg":  "audio/ogg",
    }.get(path.suffix.lower(), "application/octet-stream")


# ── Usage examples ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    client = RVCClient("http://192.168.1.190:8000")

    # ── Example 1: Simple synchronous conversion ───────────────────────────────
    print("\n=== Simple conversion ===")
    result = client.convert_voice(
        audio_file="user_voice.wav",
        voice_id="thai_food_reviewer_male",
        pitch_shift=0,
        timeout=300,
    )
    print(f"Saved to: {result['output_path']}")

    # ── Example 2: Async with progress tracking ────────────────────────────────
    print("\n=== Async with progress ===")

    def on_progress(status: str, job: dict) -> None:
        print(f"  [{job['job_id'][:8]}] {status}")

    job_id = client.convert_voice_async("user_voice.wav", "thai_food_reviewer_male")
    print(f"Submitted: {job_id}")
    # … do other work …
    job = client._poll_until_done(job_id, timeout=300, progress_callback=on_progress)
    client.download_result(job_id, "output_async.wav")

    # ── Example 3: Batch processing ───────────────────────────────────────────
    print("\n=== Batch processing ===")
    inputs = ["clip1.wav", "clip2.wav", "clip3.wav"]
    # Submit all jobs first (server queues them)
    job_ids = [
        client.convert_voice_async(f, "thai_food_reviewer_male")
        for f in inputs
    ]
    # Then collect results sequentially
    for path, jid in zip(inputs, job_ids):
        try:
            client._poll_until_done(jid, timeout=300, progress_callback=None)
            out = Path(path).with_suffix("").name + "_converted.wav"
            client.download_result(jid, out)
            print(f"  {path} → {out}")
        except RVCJobFailedError as e:
            print(f"  {path} failed: {e}")
