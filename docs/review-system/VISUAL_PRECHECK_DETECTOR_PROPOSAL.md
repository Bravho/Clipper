# Local product detector proposal (Round 5)

Recommendation: **YOLOX-nano ONNX with `onnxruntime-node`, CPU execution provider**, behind the existing `ProductDetector` interface. Install nothing in this round. The shipped runtime selects only `noop` (default) or a fixture-injected `mock`; both abstain without evidence. A general COCO detector cannot reliably recognize every dish, package or shop product. An adapter must return null for unsupported classes or ambiguous subjects, preserving the Flash/Tho fallback.

No network research, download or benchmark was performed, under this task's offline hard rules. Sizes and timings below are planning estimates, not measured Mar-PC/Mac results. Verify the chosen release's code AND weight licenses and redistribution terms before a later installation. FP32 vs INT8 and input resolution materially change size/speed.

| Candidate | Later npm package(s), model artifact | Approximate model size | License considerations | Windows x64 desktop CPU, 640px frame | Apple Silicon Mac mini CPU, 640px frame |
|---|---|---|---|---|---|
| YOLOv8n / YOLO11n ONNX | `onnxruntime-node`; `yolov8n.onnx` / `yolo11n.onnx` | FP32 ~12 MB / ~10 MB | Ultralytics AGPL-3.0 or commercial enterprise terms; distributing/integrating into a proprietary service requires license review. Do not assume an ONNX export changes the model license. | ~30–100 ms | ~20–80 ms |
| **YOLOX-nano ONNX** | `onnxruntime-node`; `yolox_nano.onnx` | FP32 ~3.6–4 MB | YOLOX upstream code Apache-2.0; confirm chosen weights/export provenance and notices. | ~20–80 ms | ~15–60 ms |
| NanoDet-Plus-m ONNX | `onnxruntime-node`; `nanodet-plus-m_320.onnx` | FP32 ~4.5–5 MB | NanoDet upstream Apache-2.0; verify artifact provenance. | ~10–45 ms | ~8–35 ms |
| MediaPipe Object Detector, EfficientDet-Lite0 / Lite2 | `@mediapipe/tasks-vision`; `efficientdet_lite0_uint8.tflite` / `efficientdet_lite2_uint8.tflite` | Quantized ~4.4 MB / ~7 MB (variant dependent) | MediaPipe code Apache-2.0; verify individual downloadable model metadata/terms. | ~20–90 / 45–180 ms | ~15–70 / 35–140 ms |
| RT-DETR R18 ONNX | `onnxruntime-node`; `rtdetr_r18.onnx` | FP32 ~80 MB | Original RT-DETR upstream Apache-2.0; do not substitute an Ultralytics export without checking its separate terms. | ~100–350 ms | ~70–250 ms |

Latency estimates include resize/normalization/inference/postprocessing after JPEG decode, exclude FFmpeg extraction, transfer, model/session startup and contact-sheet generation; warm session, one image at a time, modest thread count. Hardware generation, thermal limits and runtime versions are unknown. YOLOX-nano commonly uses a 416px input; NanoDet's listed model uses 320px; EfficientDet-Lite0/2 use their fixed native sizes (typically 320/448), so these rows mean a 640px *source* resized by the adapter. They are not equal-resolution accuracy comparisons. YOLO 640 / RT-DETR 640 have more small-object detail at higher CPU cost. Do not select based on these estimates without benchmarking representative Thai shop media on both workers.

## Exact adapter contract

Implement `ProductDetector.detect(frames: Buffer[]): Promise<(ProductDetection | null)[]>` from `src/lib/ai/ProductDetector.ts`. Inputs are FFmpeg's orientation-corrected JPEGs (longest edge <=320px today); return exactly one corresponding result per input, sequentially, without network calls. Load one local model/session once per worker process. Never download a model implicitly.

For ONNX candidates: decode with the already installed `sharp`, letterbox to the model input size, form the model's specified tensor (YOLOX: verify BGR/RGB, normalization and output-grid decode; YOLOv8/11: verify export output layout; NanoDet: implement its distributional box decode; RT-DETR: decode query scores/boxes and avoid applying YOLO-specific NMS). Undo letterboxing, choose a supported product class using a declared class allowlist and confidence/ambiguity criteria, and convert the selected box to normalized original JPEG coordinates `{x,y,w,h}` plus `confidence`. Use null for no supported product, multiple equally plausible subjects, invalid coordinates or inference errors. The service validates every box, transforms it through the 9:16 viewport, and keeps low-confidence shots for the single-image Flash fallback.

For MediaPipe: `@mediapipe/tasks-vision` offers a browser/WASM API and expects browser image/canvas facilities; it is not a drop-in supported headless Node native detector. Validate a dedicated worker/browser bridge and pinned WASM assets, or write a separate supported native TFLite bridge behind the same interface. `@tensorflow/tfjs-tflite` is also browser-oriented and is not a proven Windows/Node alternative. Extra runtime/bridge complexity makes this the second choice despite attractive quantized models.

Extend `productDetector()` with an explicit, fail-closed selector only after the dependency/model installation is separately authorized. Configure local artifact path and supported classes then; bump `STORYBOARD_VISUAL_ANALYSIS_VERSION` whenever model, preprocessing, class policy, thresholds affecting extraction, or analysis semantics change. Existing `(assetId, version)` results are immutable and must never silently be recomputed.

## Why YOLOX-nano

Small local weights, native Node ONNX execution on both target platforms, and an Apache-2.0 upstream make it a practical first experiment without the Ultralytics AGPL decision or MediaPipe's browser bridge. Evaluate null rate, product selection correctness, crop retention and p50/p95 CPU latency before rollout. NanoDet is the next small Apache-2.0 candidate; RT-DETR is a larger accuracy experiment if latency permits. No candidate supplies reliable custom food-product identity out of the box.

Upstream references for the operator to verify later (not fetched during this offline task): [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX), [ONNX Runtime Node](https://onnxruntime.ai/docs/get-started/with-javascript/node.html), [Ultralytics licensing](https://www.ultralytics.com/license), [MediaPipe Object Detector](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector), [NanoDet](https://github.com/RangiLyu/nanodet), [RT-DETR](https://github.com/lyuwenyu/RT-DETR).

## Installed detector

| Field | Value |
|-------|-------|
| Runtime | `onnxruntime-node` 1.31.1 (CPU execution provider) |
| Model | YOLOX-nano ONNX |
| Source URL | https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx |
| Release tag | 0.1.1rc0 (Megvii-BaseDetection/YOLOX) |
| SHA-256 | `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d` |
| File size | 3,659,407 bytes (~3.5 MB) |
| License | Apache-2.0 (Copyright Megvii Inc.) |
| Storage path | `models/yolox/yolox_nano.onnx` (committed to repo) |
| Implementation | `src/lib/ai/YoloxNanoDetector.ts` implements `ProductDetector` |

### How it is selected

Both flags must be `true` and `STORYBOARD_PRODUCT_DETECTOR` must be `yolox`:

```
STORYBOARD_AI_PRECHECK_ENABLED=true
STORYBOARD_VISUAL_PRECHECK_ENABLED=true
STORYBOARD_PRODUCT_DETECTOR=yolox
```

Default (flags missing or `STORYBOARD_PRODUCT_DETECTOR` unset): `NoopProductDetector`.
`STORYBOARD_PRODUCT_DETECTOR=mock`: `MockProductDetector` (test fixture injection).
The singleton is cached for the worker process lifetime.

Optional path override: `STORYBOARD_YOLOX_MODEL_PATH=<absolute path>` (default: `<cwd>/models/yolox/yolox_nano.onnx`).

### Preprocessing

1. Decode JPEG buffer with `sharp`.
2. Read source dimensions (`srcW`, `srcH`).
3. Compute `scale = min(416/srcW, 416/srcH)` (keep aspect ratio).
4. Resize to `(round(srcW×scale), round(srcH×scale))` using `fit: fill`.
5. Place at top-left (0, 0) in a `[1, 3, 416, 416]` float32 CHW tensor filled with `114.0`.
6. Channel order: BGR (channel 0=B, 1=G, 2=R). No mean/std normalization (raw 0–255).

### Output decoding

YOLOX ONNX output `[1, 3549, 85]`. Stride groups (in order): 8→52×52, 16→26×26, 32→13×13.

Each row: `[cx, py, pw, ph, obj_conf, cls_0…cls_79]`. `obj_conf` and `cls_*` are already
sigmoid-activated inside the ONNX graph. Box decode:
`x=(px+gx)×s`, `y=(py+gy)×s`, `w=exp(pw)×s`, `h=exp(ph)×s` (in letterboxed 416px space).

Post-decode: undo letterbox (`÷scale`), normalize by source dimensions, IoU-NMS
(`threshold=0.45`), pick top-1 box. Confidence = `obj_conf × max(cls_score)`.

### Limitations

- General COCO-80 detector; no product-specific taxonomy.
- CPU only; no GPU, CoreML, or DirectML provider configured.
- One box per frame (NMS top-1); multiple overlapping products collapsed.
- Not trained on Thai shop media; null rate on ambiguous frames may be high.
- Class allowlist configurable via `STORYBOARD_YOLOX_CLASS_ALLOWLIST` (COCO indices).

## Rollout and limitations

Apply migration `055_asset_visual_analyses.sql` separately, deploy web and render worker, then enable both flags. Analysis is queued when LINE upload keys become durable asset records on submission, not in the webhook download process. The worker samples once (three per clip, one per photo), persists private JPEGs/metrics, and re-enters a deferred storyboard gate after the final queued analysis finishes. Failed analyses surface `analysis_missing` to Tho. Abandoned claims expire after `STORYBOARD_VISUAL_CLAIM_TIMEOUT_SECONDS` (default 900) and re-enter the review gate as missing analysis; inference is never replayed. An operator can explicitly bump the analysis version and re-enqueue if needed. This favors the requested never-redo guarantee over automatic inference retries.

Stored frames are private DB data, never notifier payloads or public objects. The owner must include these rows in the seven-day LINE source-retention operation (or delete their parent upload records; the FK cascades). Existing object-only Spaces cleanup does not purge DB JPEGs. No cleanup was run. Framing validation samples the source rather than proving every intervening frame. It applies to 9:16; other export ratios retain the existing composition behavior. The contact sheet contains all used samples, reduced to <=384px; large plans may have tiny thumbnails and should fail to human review when ambiguous.
