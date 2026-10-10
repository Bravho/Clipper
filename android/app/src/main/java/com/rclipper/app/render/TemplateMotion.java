package com.rclipper.app.render;

import org.json.JSONArray;

import java.util.Arrays;

/**
 * The motion-template (Look) motion model — a line-for-line port of
 * `src/lib/motionTemplates/motion.ts`, the reference for every renderer.
 * Change one, change all three (and iOS `OverlayPainter.swift`).
 *
 * Time `t` is seconds on the finished video's timeline. `beats` are the scene
 * cut times; `end` is the video's length, NaN when unknown (no progress bar,
 * no outro).
 */
public final class TemplateMotion {

    private TemplateMotion() {}

    public static double clamp01(double x) {
        return Math.min(1d, Math.max(0d, x));
    }

    public static double easeOutCubic(double x) {
        return 1d - Math.pow(1d - clamp01(x), 3);
    }

    public static double easeInOutCubic(double x) {
        double v = clamp01(x);
        return v < 0.5d ? 4d * v * v * v : 1d - Math.pow(-2d * v + 2d, 3) / 2d;
    }

    public static double easeInOutSine(double x) {
        return -(Math.cos(Math.PI * clamp01(x)) - 1d) / 2d;
    }

    /** Back ease-out (c1 = 1.70158): overshoots ~10 % and settles. */
    public static double easeOutBack(double x) {
        double v = clamp01(x);
        double c1 = 1.70158d;
        double c3 = c1 + 1d;
        return 1d + c3 * Math.pow(v - 1d, 3) + c1 * Math.pow(v - 1d, 2);
    }

    public static double ramp(double t, double start, double duration) {
        if (duration <= 0d) return t >= start ? 1d : 0d;
        return clamp01((t - start) / duration);
    }

    public static double wave(double t, double period, double phase) {
        return Math.sin(2d * Math.PI * (t / period + phase));
    }

    public static double wave(double t, double period) {
        return wave(t, period, 0d);
    }

    public static double beatEnvelope(double t, double[] beats, double attack, double decay) {
        double best = 0d;
        for (double b : beats) {
            double d = t - b;
            double v = 0d;
            if (d >= -attack && d < 0d) v = easeOutCubic((d + attack) / attack);
            else if (d >= 0d && d < decay) v = 1d - easeInOutSine(d / decay);
            if (v > best) best = v;
        }
        return best;
    }

    public static int sceneIndex(double t, double[] beats) {
        int index = 0;
        for (double b : beats) if (t >= b) index++;
        return index;
    }

    public static int sceneCount(double[] beats) {
        return beats.length + 1;
    }

    public static double sceneFraction(double t, double[] beats, double end) {
        int index = sceneIndex(t, beats);
        double start = index == 0 ? 0d : beats[index - 1];
        double stop = index < beats.length ? beats[index] : end;
        if (Double.isNaN(stop) || !(stop > start)) return 1d;
        return clamp01((t - start) / (stop - start));
    }

    public static double videoProgress(double t, double end) {
        return !Double.isNaN(end) && end > 0d ? clamp01(t / end) : 0d;
    }

    public static double outro(double t, double end, double length) {
        if (Double.isNaN(end) || !(end > length * 1.5d)) return 0d;
        return ramp(t, end - length, length);
    }

    /** Progress through the active beat window [b − lead, b − lead + duration); −1 if none. */
    public static double beatProgress(double t, double[] beats, double lead, double duration) {
        double found = -1d;
        for (double b : beats) {
            double start = b - lead;
            if (t >= start && t < start + duration) found = (t - start) / duration;
        }
        return found;
    }

    /** `normaliseTimeline`: finite, ascending, strictly inside (0.3, end − 0.3). */
    public static double[] normaliseBeats(JSONArray array, double end) {
        if (array == null) return new double[0];
        double[] out = new double[array.length()];
        int n = 0;
        for (int i = 0; i < array.length(); i++) {
            double b = array.optDouble(i, Double.NaN);
            if (Double.isNaN(b) || Double.isInfinite(b)) continue;
            if (b <= 0.3d) continue;
            if (!Double.isNaN(end) && b >= end - 0.3d) continue;
            out[n++] = b;
        }
        double[] beats = Arrays.copyOf(out, n);
        Arrays.sort(beats);
        return beats;
    }
}
