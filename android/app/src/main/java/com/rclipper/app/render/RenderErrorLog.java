package com.rclipper.app.render;

import android.media.MediaMetadataRetriever;
import android.os.Build;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.ExportException;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What happened during one render, in order, so a failure can say WHY.
 *
 * A render that fails used to surface as one line — often Media3's bare
 * "Video frame processing error" — after the renderer had already tried and
 * quietly given up on two or three fallbacks. This keeps every step, every
 * failed attempt with its full cause chain (Media3's error code, the codec that
 * refused, the underlying exception), and the facts about each input that
 * decide most failures: the file's size, the clip's codec, resolution,
 * rotation, frame rate and whether it is HDR. The plugin hands the lines back
 * to the web layer, which shows them to the person and stores them with the
 * attempt on the server.
 *
 * {@link #diagnose} turns the first failure into one plain sentence: the root
 * cause as a person would say it, with the technical line underneath.
 */
@OptIn(markerClass = UnstableApi.class)
public final class RenderErrorLog {

    private static final int MAX_LINES = 80;
    private static final int MAX_LINE = 400;

    private final long startedAt = System.currentTimeMillis();
    private final List<String> lines = new ArrayList<>();
    /** The first failure seen, and the latest (the simplest fallback's). */
    private Throwable firstFailure;
    private Throwable lastFailure;

    public RenderErrorLog() {
        note("Phone: " + Build.MANUFACTURER + " " + Build.MODEL + ", Android API " + Build.VERSION.SDK_INT);
    }

    public synchronized void note(String line) {
        if (lines.size() >= MAX_LINES) return;
        double seconds = (System.currentTimeMillis() - startedAt) / 1000d;
        String text = String.format(Locale.US, "[%5.1fs] %s", seconds, line);
        lines.add(text.length() > MAX_LINE ? text.substring(0, MAX_LINE) + "…" : text);
    }

    /** One failed attempt; the renderer may still recover with a fallback. */
    public synchronized void failure(String attempt, Throwable error) {
        if (firstFailure == null) firstFailure = error;
        lastFailure = error;
        note(attempt + " FAILED — " + chain(error));
    }

    public synchronized List<String> lines() {
        return new ArrayList<>(lines);
    }

    public synchronized Throwable firstFailure() {
        return firstFailure;
    }

    /**
     * The failure of the last attempt made — the simplest configuration the
     * renderer tried. When even that fails, its cause is the fundamental one
     * (a clip this phone cannot decode, say), so this is what is diagnosed.
     */
    public synchronized Throwable lastFailure() {
        return lastFailure;
    }

    /** The facts about one input that decide whether a phone can decode it. */
    public void describeInput(String key, File file, boolean isClip) {
        if (file == null || !file.isFile()) {
            note("Input " + key + ": MISSING");
            return;
        }
        String size = String.format(Locale.US, "%.1f MB", file.length() / 1_000_000d);
        if (!isClip) {
            int[] picture = ShotFraming.pictureSize(file, true);
            note("Input " + key + " (photo): " + size
                + (picture != null ? ", " + picture[0] + "×" + picture[1] : ", could not read its size"));
            return;
        }
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String mime = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE);
            String width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            String rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            String fps = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE);
            String transfer = Build.VERSION.SDK_INT >= 30
                ? retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_COLOR_TRANSFER)
                : null;
            // 6 = ST 2084 (HDR10), 7 = HLG: the formats cheap phones cannot decode
            // into an SDR pipeline.
            boolean hdr = "6".equals(transfer) || "7".equals(transfer);
            note("Input " + key + " (clip): " + size
                + ", " + (mime == null ? "unknown container" : mime)
                + ", " + width + "×" + height
                + (rotation != null && !"0".equals(rotation) ? " rotated " + rotation + "°" : "")
                + (duration != null ? String.format(Locale.US, ", %.1fs", Long.parseLong(duration) / 1000d) : "")
                + (fps != null ? ", " + fps + " fps" : "")
                + (hdr ? ", HDR" : ""));
        } catch (Exception error) {
            note("Input " + key + " (clip): " + size + ", the phone could not read it as a video — "
                + chain(error));
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
                // Nothing to do.
            }
        }
    }

    /** "ExportException[ERROR_CODE_DECODING_FAILED, decoder c2.x (video/hevc)]: … ← cause: …" */
    public static String chain(Throwable error) {
        StringBuilder text = new StringBuilder();
        Throwable current = error;
        for (int depth = 0; current != null && depth < 5; depth++) {
            if (depth > 0) text.append(" ← caused by ");
            text.append(current.getClass().getSimpleName());
            if (current instanceof ExportException) {
                ExportException export = (ExportException) current;
                text.append('[').append(export.getErrorCodeName());
                ExportException.CodecInfo codec = export.codecInfo;
                if (codec != null) {
                    text.append(", ")
                        .append(codec.isDecoder ? "decoder " : "encoder ")
                        .append(codec.name)
                        .append(" (")
                        .append(codec.configurationFormat)
                        .append(')');
                }
                text.append(']');
            }
            String message = current.getMessage();
            if (message != null && !message.isEmpty()) text.append(": ").append(message);
            if (current.getCause() == current) break;
            current = current.getCause();
        }
        return text.toString();
    }

    /** The root cause as one plain sentence. */
    public static String diagnose(Throwable error) {
        if (error == null) return "The render stopped without saying why.";
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof OutOfMemoryError) {
                return "The phone ran out of memory while making the video. Close other apps and try again, or use shorter or lower-resolution clips.";
            }
            if (current instanceof FileNotFoundException) {
                return "A photo or clip could not be opened on this phone (" + current.getMessage() + ").";
            }
            if (current instanceof ExportException) {
                ExportException export = (ExportException) current;
                String code = export.getErrorCodeName();
                ExportException.CodecInfo codec = export.codecInfo;
                String format = codec != null && codec.configurationFormat != null
                    ? " (" + codec.configurationFormat + ")" : "";
                if (code == null) code = "";
                if (code.contains("DECODING_FORMAT_UNSUPPORTED") || code.contains("DECODER_INIT_FAILED")) {
                    return "This phone cannot decode one of the clips" + format
                        + ". It is often a 4K, 60 fps, HDR or HEVC clip — re-record it in 1080p, or turn off HDR, and add it again.";
                }
                if (code.contains("DECODING_FAILED")) {
                    return "This phone started reading a clip but its decoder stopped" + format
                        + ". The clip may be damaged, HDR, or too demanding for this phone.";
                }
                if (code.contains("ENCODER_INIT_FAILED") || code.contains("ENCODING_FORMAT_UNSUPPORTED")) {
                    return "This phone's video encoder refused the output" + format
                        + ". It may not support this size — try again, or report this phone model.";
                }
                if (code.contains("ENCODING_FAILED")) {
                    return "This phone's video encoder stopped part-way" + format + ".";
                }
                if (code.contains("VIDEO_FRAME_PROCESSING_FAILED")) {
                    return "The phone's graphics processor failed while drawing the frames (framing, camera moves, transitions or captions).";
                }
                if (code.contains("AUDIO_PROCESSING_FAILED")) {
                    return "The phone could not process the sound (voice-over or background music).";
                }
                if (code.contains("MUXING")) {
                    return "The phone could not write the finished video file. Check that there is free storage.";
                }
                if (code.startsWith("ERROR_CODE_IO")) {
                    return "A photo, clip or sound file could not be read (" + code + ").";
                }
            }
        }
        String message = error.getMessage();
        return message != null && !message.isEmpty()
            ? message
            : "The render failed with " + error.getClass().getSimpleName() + ".";
    }
}
