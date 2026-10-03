package com.rclipper.app.render;

import android.graphics.Matrix;

/**
 * The Ken Burns and transition geometry, in the form Media3 wants it.
 *
 * This is the Java half of `src/lib/mobile/deviceRenderCaptions.ts`, which is
 * itself the phone-side restatement of `remotion/montageMotion.ts`. All three
 * have to agree, so the keyframe table below is copied verbatim rather than
 * paraphrased, and the only interesting code here is the coordinate conversion.
 *
 * COORDINATES. Remotion animates with a CSS transform:
 *
 *     transform: scale(s) translate(tx%, ty%);
 *     transform-origin: focusX% focusY%;
 *
 * CSS applies a transform list right-to-left, so a point p becomes
 * `o + s * (p + t - o)` where `t` is the translate expressed in the element's
 * own box and `o` is the origin. Media3's {@code MatrixTransformation} works in
 * normalised device coordinates: the frame spans [-1, 1] on both axes, y points
 * UP (CSS y points down), and the matrix maps input vertices to output
 * vertices. Converting is therefore:
 *
 *     t_ndc = (fraction * 2, -fraction * 2)      // box width is 2 in NDC
 *     o_ndc = (focusX * 2 - 1, 1 - focusY * 2)
 *     M = translate(t_ndc) then scale(s) then translate(o_ndc * (1 - s))
 *
 * Getting this wrong is the classic phone-render bug: the zoom looks right and
 * the pans drift the wrong way or by twice the distance, which nobody notices
 * until a side-by-side comparison.
 */
public final class MotionMath {

    private MotionMath() {}

    /** Mirrors `KEN_BURNS_KEYFRAMES`. */
    public static float[] keyframes(String motion) {
        // { scaleFrom, scaleTo, txFrom, txTo, tyFrom, tyTo } — translates in percent.
        switch (motion == null ? "static" : motion) {
            case "ken_burns_in":  return new float[] { 1.00f, 1.25f,  0f,  0f, 0f, 0f };
            case "ken_burns_out": return new float[] { 1.25f, 1.00f,  0f,  0f, 0f, 0f };
            // The camera direction is opposite the image's translation: moving
            // the oversized image right reveals its left side, so the camera
            // pans left.
            case "pan_left":      return new float[] { 1.18f, 1.18f, -7f,  7f, 0f, 0f };
            case "pan_right":     return new float[] { 1.18f, 1.18f,  7f, -7f, 0f, 0f };
            default:              return new float[] { 1.00f, 1.00f,  0f,  0f, 0f, 0f };
        }
    }

    public static float clamp(float value, float min, float max) {
        return Math.min(max, Math.max(min, value));
    }

    private static float lerp(float from, float to, float progress) {
        return from + (to - from) * progress;
    }

    /**
     * The Ken Burns matrix for a still at `progress` (0..1 across its slot),
     * about the subject-focus origin.
     */
    public static Matrix kenBurns(String motion, float progress, float focusX, float focusY) {
        float p = clamp(progress, 0f, 1f);
        float[] k = keyframes(motion);
        float scale = lerp(k[0], k[1], p);
        float txFraction = lerp(k[2], k[3], p) / 100f;
        float tyFraction = lerp(k[4], k[5], p) / 100f;
        return transform(scale, txFraction, tyFraction, focusX, focusY);
    }

    /**
     * Build the NDC matrix for a scale about a focus origin plus a translate
     * expressed as a fraction of the element's own box.
     */
    public static Matrix transform(
        float scale, float txFraction, float tyFraction, float focusX, float focusY
    ) {
        float originX = clamp(focusX, 0f, 1f) * 2f - 1f;
        // CSS y grows downward, NDC y grows upward.
        float originY = 1f - clamp(focusY, 0f, 1f) * 2f;

        Matrix matrix = new Matrix();
        // p + t
        matrix.postTranslate(txFraction * 2f, -tyFraction * 2f);
        // s * (p + t)
        matrix.postScale(scale, scale);
        // + o * (1 - s)  →  o + s * (p + t - o)
        matrix.postTranslate(originX * (1f - scale), originY * (1f - scale));
        return matrix;
    }

    /**
     * The extra flourish a named transition layers on top of the dissolve, as a
     * matrix for the INCOMING shot during its fade window.
     *
     *   slide — `translateX((1 - fade) * 12%)`
     *   zoom  — `scale(1.04 - 0.04 * fade)`
     *   fade / cut — none
     *
     * `fade` is the dissolve progress, 0 at the start of the overlap and 1 when
     * the incoming shot is fully on screen.
     */
    public static Matrix entrance(String transition, float fade) {
        float f = clamp(fade, 0f, 1f);
        if ("slide".equals(transition)) {
            return transform(1f, (1f - f) * 0.12f, 0f, 0.5f, 0.5f);
        }
        if ("zoom".equals(transition)) {
            return transform(1.04f - 0.04f * f, 0f, 0f, 0.5f, 0.5f);
        }
        return new Matrix();
    }

    /**
     * Playback rate for a clip whose slot outruns its footage — slow it down
     * rather than freezing the last frame. Mirrors `computeClipPlaybackRate`;
     * `MIN_CLIP_PLAYBACK_RATE` is 0.8, i.e. at most a 1.25x stretch.
     */
    public static float playbackRate(double footageSeconds, double slotSeconds) {
        if (!(footageSeconds > 0) || !(slotSeconds > 0)) return 1f;
        if (slotSeconds <= footageSeconds) return 1f;
        return clamp((float) (footageSeconds / slotSeconds), 0.8f, 1f);
    }

    /**
     * Allocate whole frames across a scene's shots in proportion to their
     * durations, every shot getting at least one frame and the last absorbing
     * the remainder. Mirrors `allocateAssetFrames` so a scene is the same
     * length on all three renderers.
     *
     * @return {from, durationInFrames} pairs, contiguous and covering [0, total).
     */
    public static int[][] allocateFrames(double[] durationsSeconds, int totalFrames) {
        int n = durationsSeconds.length;
        if (n == 0) return new int[0][];

        int safeTotal = Math.max(n, totalFrames);
        double sum = 0;
        for (double d : durationsSeconds) if (d > 0) sum += d;

        int[][] ranges = new int[n][2];
        int acc = 0;
        for (int i = 0; i < n; i++) {
            double weight = sum > 0 ? Math.max(0, durationsSeconds[i]) / sum : 1d / n;
            int frames;
            if (i == n - 1) {
                frames = Math.max(1, safeTotal - acc);
            } else {
                int remainingAfter = n - 1 - i;
                int maxForThis = Math.max(1, safeTotal - acc - remainingAfter);
                frames = Math.min(maxForThis, Math.max(1, (int) Math.round(weight * safeTotal)));
            }
            ranges[i][0] = acc;
            ranges[i][1] = frames;
            acc += frames;
        }
        return ranges;
    }
}
