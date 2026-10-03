package com.rclipper.app.render;

import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.media.MediaMetadataRetriever;

import java.io.File;

/**
 * How much of a photo or clip a shot shows when its shape is not the video's.
 *
 * The Java copy of `src/lib/mobile/shotFraming.ts` — read that file for the
 * why. `frameZoom` 0 shows the whole picture (black bars fill the rest), 1 fills
 * the frame and crops the edges around the focus point, and the scale between
 * them is interpolated geometrically: `fit * (cover / fit) ^ zoom`.
 *
 * HOW IT IS APPLIED. {@code Presentation.LAYOUT_SCALE_TO_FIT} first puts the
 * whole picture on the canvas, centred, at the "fit" scale. The matrix from
 * {@link #placement} then grows it by `(cover / fit) ^ zoom` and moves its
 * centre to where the TypeScript placement puts it — clamped so the picture
 * never slides off an edge it is covering. Media3 clips whatever leaves the
 * frame. Coordinates are Media3's NDC: [-1, 1] on both axes, y up.
 */
public final class ShotFraming {

    private ShotFraming() {}

    /** Below this, the new framing path runs; at 1 the old cover crop stays. */
    public static boolean needsPlacement(float frameZoom, float focusX, float focusY) {
        return frameZoom < 0.999f
            || Math.abs(focusX - 0.5f) > 0.001f
            || Math.abs(focusY - 0.5f) > 0.001f;
    }

    private static float clamp(float value, float min, float max) {
        return Math.min(max, Math.max(min, value));
    }

    /** Mirrors `place` in shotFraming.ts: centred when it fits, else about focus. */
    private static float place(float drawn, float room, float focus) {
        if (drawn <= room) return (room - drawn) / 2f;
        return clamp(room / 2f - clamp(focus, 0f, 1f) * drawn, room - drawn, 0f);
    }

    /**
     * The matrix to apply AFTER a scale-to-fit Presentation, or null when the
     * picture's size is unknown (the caller then keeps the plain cover crop).
     */
    public static Matrix placement(
        int pictureWidth, int pictureHeight,
        int canvasWidth, int canvasHeight,
        float frameZoom, float focusX, float focusY
    ) {
        if (pictureWidth <= 0 || pictureHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
            return null;
        }
        float pw = pictureWidth, ph = pictureHeight, cw = canvasWidth, ch = canvasHeight;
        float fit = Math.min(cw / pw, ch / ph);
        float cover = Math.max(cw / pw, ch / ph);
        float zoom = clamp(frameZoom, 0f, 1f);
        float grow = (float) Math.pow(cover / fit, zoom);
        float scale = fit * grow;
        float width = pw * scale;
        float height = ph * scale;
        float x = place(width, cw, focusX);
        float y = place(height, ch, focusY);

        // Where the picture's centre ends up, in NDC (y up).
        float centreX = ((x + width / 2f) / cw) * 2f - 1f;
        float centreY = 1f - ((y + height / 2f) / ch) * 2f;

        Matrix matrix = new Matrix();
        matrix.postScale(grow, grow);
        matrix.postTranslate(centreX, centreY);
        return matrix;
    }

    /**
     * The picture's displayed size — rotation and EXIF orientation applied — or
     * null when it cannot be read.
     */
    public static int[] pictureSize(File file, boolean isImage) {
        try {
            if (isImage) {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
                int orientation = ExifInterface.ORIENTATION_NORMAL;
                try {
                    orientation = new ExifInterface(file.getAbsolutePath())
                        .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                } catch (Exception ignored) {
                    // No EXIF is the common case for a downscaled derivative.
                }
                boolean turned = orientation == ExifInterface.ORIENTATION_ROTATE_90
                    || orientation == ExifInterface.ORIENTATION_ROTATE_270
                    || orientation == ExifInterface.ORIENTATION_TRANSPOSE
                    || orientation == ExifInterface.ORIENTATION_TRANSVERSE;
                return turned
                    ? new int[] { bounds.outHeight, bounds.outWidth }
                    : new int[] { bounds.outWidth, bounds.outHeight };
            }
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(file.getAbsolutePath());
                int width = parse(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
                int height = parse(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
                int rotation = parse(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
                if (width <= 0 || height <= 0) return null;
                return (rotation % 180 != 0)
                    ? new int[] { height, width }
                    : new int[] { width, height };
            } finally {
                try {
                    retriever.release();
                } catch (Exception ignored) {
                    // Nothing useful to do.
                }
            }
        } catch (Exception failure) {
            return null;
        }
    }

    private static int parse(String value) {
        if (value == null) return 0;
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException failure) {
            return 0;
        }
    }
}
