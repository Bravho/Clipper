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
 * compositing, and {@link VideoCompositorSettings} is asked for each input's
 * alpha at every frame.
 *
 * LANE 0 IS ON TOP. `DefaultVideoCompositor` overlays inputs "in the reverse
 * order of their registration order, so that the first registered source is on
 * the very top". Lane 0 (sequence 0) is therefore the upper layer and lane 1
 * the lower one. While a lane sits in a Gap, Media3 feeds it a 16x16 BLACK
 * bitmap that is not scaled to the canvas, so it composites as a small black
 * square in the dead centre of the frame. An earlier version held lane 0 at
 * alpha 1 for the whole video, which (a) stamped that square over every shot
 * that played on lane 1 and (b) hid lane 1 during every dissolve, turning the
 * dissolves into hard cuts. So the fade lives on lane 0, the top layer, and
 * lane 1 stays opaque underneath: whenever lane 0 is in a gap it is at alpha 0
 * and its black filler cannot be seen.
 *
 * So {@link ManifestRenderer#buildMontage} ping-pongs the shots between the two
 * sequences — shot 0 on lane 0, shot 1 on lane 1, shot 2 on lane 0 — and this
 * class answers the only remaining question: how much of lane 1 shows right
 * now ({@link #overlayAlpha}). Lane 0, on top, is drawn at the complement.
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
        // Lane 0 is the TOP layer (see the class comment), so it carries the
        // fade: transparent while lane 1 holds the shot (lane 0 is then in a
        // Gap, whose 16x16 black filler would otherwise show as a dot in the
        // centre), opaque while it holds the shot itself. Lane 1, under it,
        // stays opaque; its own gap filler is always covered by lane 0.
        float alpha = inputId == 0
            ? 1f - overlayAlpha(presentationTimeUs / 1_000_000d)
            : 1f;
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
