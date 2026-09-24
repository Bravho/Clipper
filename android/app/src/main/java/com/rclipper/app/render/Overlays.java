package com.rclipper.app.render;

import android.graphics.Bitmap;
import android.graphics.Color;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.BitmapOverlay;

/**
 * Media3 overlays for the caption and template layers.
 *
 * Media3 draws a {@link BitmapOverlay} by asking for a bitmap at each frame's
 * presentation time. Two rules make this cheap enough to run at 30 fps on a
 * mid-range phone:
 *
 *   - Never allocate per frame. {@link CaptionPainter} and
 *     {@link TemplatePainter} each own one bitmap and redraw it in place; a
 *     settled template is returned unchanged, so it is not re-uploaded.
 *   - Never return null. Media3 treats a null bitmap as an error, so a frame
 *     with no caption returns a transparent bitmap instead. A frame-sized
 *     transparent overlay composites to a no-op, which is cheaper than
 *     reconfiguring the effect chain mid-export.
 *
 * A frame-sized overlay bitmap maps 1:1 onto the frame under Media3's default
 * overlay settings, so no scaling or anchoring is configured here — the painter
 * already works in output pixels.
 */
@OptIn(markerClass = UnstableApi.class)
public final class Overlays {

    private Overlays() {}

    /** Timed captions, redrawn per frame from the manifest's cue list. */
    public static final class CaptionOverlay extends BitmapOverlay {
        private final CaptionPainter painter;
        private final Bitmap blank;

        public CaptionOverlay(CaptionPainter painter, int width, int height) {
            this.painter = painter;
            this.blank = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            this.blank.eraseColor(Color.TRANSPARENT);
        }

        @Override
        public Bitmap getBitmap(long presentationTimeUs) {
            Bitmap drawn = painter.draw(presentationTimeUs / 1_000_000d);
            return drawn != null ? drawn : blank;
        }

        public void release() {
            painter.release();
            if (!blank.isRecycled()) blank.recycle();
        }
    }

    /**
     * The template frame and decor. The painter animates the draw-on strokes,
     * the bracket ease-in and the ripples frame by frame, and hands back the same
     * settled bitmap once nothing moves any more.
     */
    public static final class TemplateOverlay extends BitmapOverlay {
        private final TemplatePainter painter;
        private final Bitmap blank;

        public TemplateOverlay(TemplatePainter painter, int width, int height) {
            this.painter = painter;
            this.blank = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            this.blank.eraseColor(Color.TRANSPARENT);
        }

        @Override
        public Bitmap getBitmap(long presentationTimeUs) {
            Bitmap drawn = painter.draw(presentationTimeUs / 1_000_000d);
            return drawn != null ? drawn : blank;
        }

        public void release() {
            painter.release();
            if (!blank.isRecycled()) blank.recycle();
        }
    }
}
