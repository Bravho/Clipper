package com.rclipper.app.render;

import androidx.annotation.OptIn;
import androidx.media3.common.OverlaySettings;
import androidx.media3.common.VideoCompositorSettings;
import androidx.media3.common.util.Size;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.StaticOverlaySettings;

import java.util.List;

/**
 * The cross-dissolve, expressed as an alpha curve on one compositor input.
 *
 * WHY IT LOOKS LIKE THIS. Remotion dissolves by mounting the incoming shot
 * early, on top of the outgoing shot's tail, and fading it in — "a true
 * cross-dissolve (not a dip to black)", as `MontageScene.tsx` puts it. Media3
 * has no transition primitive at all. What it does have is multi-sequence
 * compositing: sequence 0 is the background, sequence 1 is drawn over it, and
 * {@link VideoCompositorSettings} is asked for input 1's alpha at every frame.
 *
 * So {@link ManifestRenderer#buildMontage} ping-pongs the shots between the two
 * sequences — shot 0 on lane 0, shot 1 on lane 1, shot 2 on lane 0 — and this
 * class answers the only remaining question: how opaque is lane 1 right now.
 *
 *   - Outside any dissolve, lane 1 is fully opaque while it holds the current
 *     shot and fully transparent while lane 0 does.
 *   - During the dissolve into shot i, alpha ramps 0 -> 1 when shot i is on
 *     lane 1 (the incoming shot fades IN over the outgoing one), and 1 -> 0
 *     when shot i is on lane 0 (the outgoing shot on lane 1 fades OUT to
 *     reveal it). Both are the same ramp seen from opposite sides, which is why
 *     one function covers every join.
 *
 * The ramp is linear, matching the overlay's `clamp(frame / fadeInFrames)`.
 */
@OptIn(markerClass = UnstableApi.class)
public final class CrossDissolveCompositorSettings implements VideoCompositorSettings {

    private final int shotCount;
    /** Slot start of each shot, seconds. */
    private final double[] starts;
    /** Slot length of each shot, seconds. */
    private final double[] durations;
    /** Dissolve going INTO each shot, seconds. 0 for a cut and for shot 0. */
    private final double[] dissolves;
    private final int width;
    private final int height;

    public CrossDissolveCompositorSettings(
        List<RenderManifest.Shot> shots,
        double[] starts,
        double[] dissolves,
        RenderManifest manifest
    ) {
        this.shotCount = shots.size();
        this.starts = starts;
        this.dissolves = dissolves;
        this.durations = new double[shots.size()];
        for (int i = 0; i < shots.size(); i++) durations[i] = shots.get(i).durationSeconds;
        this.width = manifest.width;
        this.height = manifest.height;
    }

    @Override
    public Size getOutputSize(List<Size> inputSizes) {
        // The canvas is fixed by the manifest's ratio, not negotiated from the
        // inputs — every shot has already been cover-cropped to it.
        return new Size(width, height);
    }

    @Override
    public OverlaySettings getOverlaySettings(int inputId, long presentationTimeUs) {
        float alpha = inputId == 0 ? 1f : overlayAlpha(presentationTimeUs / 1_000_000d);
        return new StaticOverlaySettings.Builder().setAlphaScale(alpha).build();
    }

    /**
     * Alpha of the overlaying sequence (lane 1) at time `t`.
     *
     * Package-private rather than private so the instrumentation test can walk
     * the curve across every join without exporting a video to look at it.
     */
    float overlayAlpha(double t) {
        if (shotCount == 0) return 0f;

        for (int i = 0; i < shotCount; i++) {
            double start = starts[i];
            double end = start + durations[i];
            double dissolve = dissolves[i];

            // Inside shot i's dissolve window, which sits just before its slot.
            if (dissolve > 0 && t >= start - dissolve && t < start) {
                float fade = (float) ((t - (start - dissolve)) / dissolve);
                boolean incomingIsOverlay = (i % 2) == 1;
                return MotionMath.clamp(incomingIsOverlay ? fade : 1f - fade, 0f, 1f);
            }

            // Inside shot i's own slot, past any dissolve.
            if (t >= start && t < end) {
                return (i % 2) == 1 ? 1f : 0f;
            }
        }

        // Past the last shot: hold whatever lane it was on, so the final frame
        // does not flash the other lane's stale content while the encoder
        // drains.
        return ((shotCount - 1) % 2) == 1 ? 1f : 0f;
    }
}
