# YOLOX-nano ONNX model

| Field | Value |
|-------|-------|
| Source | https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx |
| Release tag | 0.1.1rc0 |
| Publisher | Megvii-BaseDetection / Megvii Inc. |
| License | Apache-2.0 (YOLOX repository LICENSE) |
| SHA-256 | `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d` |
| File size | 3,659,407 bytes (~3.5 MB) |
| Storage path | `models/yolox/yolox_nano.onnx` (committed, not downloaded at runtime) |

## Model details

- **Architecture:** YOLOX-nano, anchor-free single-stage detector
- **Input:** `images` — float32 `[1, 3, 416, 416]`, BGR channel order, raw 0–255 (no mean/std normalization)
- **Output:** `output` — float32 `[1, 3549, 85]`
  - 3549 = 52×52 + 26×26 + 13×13 (strides 8 / 16 / 32 for a 416 px input)
  - Each row: `[cx, cy, w, h, obj_conf, cls_0 … cls_79]`
  - `obj_conf` and `cls_*` scores are sigmoid-activated inside the ONNX graph
  - Box regression needs grid/stride decode: `x=(px+gx)×s`, `y=(py+gy)×s`, `w=exp(pw)×s`, `h=exp(ph)×s`
- **Classes:** COCO-80 (0-indexed). "Product" = highest-confidence object box; no custom product taxonomy.

## Class policy

YOLOX-nano is a general COCO-80 object detector. The `YoloxNanoDetector` adapter
returns the highest-confidence detected object as the "product" box.
All 80 classes are accepted by default; restrict via `STORYBOARD_YOLOX_CLASS_ALLOWLIST`
(comma-separated COCO indices, e.g. `39,40,41,45,46,47,48,49,50,51,52,53,54,55`).

## Preprocessing (letterbox)

1. Decode JPEG with `sharp`.
2. Compute `scale = min(416/srcW, 416/srcH)`.
3. Resize to `(round(srcW×scale), round(srcH×scale))` with `fit: fill`.
4. Place at top-left (0,0) in a 416×416 canvas filled with `114.0`.
5. Arrange as CHW float32 in BGR order (channels 0=B, 1=G, 2=R). No mean/std subtraction.

## Limitations

- General COCO detector: cannot distinguish between dish types, branded packaging, or
  non-COCO shop products. Returns null rather than inventing a low-confidence box.
- CPU inference only (onnxruntime-node, no GPU/CoreML/DirectML provider configured).
- Not trained for Thai shop media specifically; may miss small or partially-occluded products.
- One box per frame (NMS top-1); overlapping product clusters are collapsed.

## How to enable

```
STORYBOARD_AI_PRECHECK_ENABLED=true
STORYBOARD_VISUAL_PRECHECK_ENABLED=true
STORYBOARD_PRODUCT_DETECTOR=yolox
# Optional: absolute path override (default: <repo>/models/yolox/yolox_nano.onnx)
STORYBOARD_YOLOX_MODEL_PATH=
```

Both precheck flags must be `true`. Detector defaults to `noop` otherwise.

## Re-downloading the model

If the model file is absent, run:

```bash
node scripts/fetch-yolox-model.cjs
```

This downloads from the official Megvii release URL, verifies SHA-256, and saves to
`models/yolox/yolox_nano.onnx`. It never overwrites an existing file.

## Copyright notice

Copyright 2021 Megvii Inc. Licensed under the Apache License, Version 2.0.
See [YOLOX LICENSE](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/LICENSE).
