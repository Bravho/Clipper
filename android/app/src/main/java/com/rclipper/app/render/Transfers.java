package com.rclipper.app.render;

import android.media.MediaMetadataRetriever;
import android.graphics.Bitmap;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * File transfers for the render path: download inputs, upload outputs, extract
 * a cover.
 *
 * STREAMED, ALWAYS. `nativeDownload.ts` converts a whole response to base64 for
 * sharing; that is fine for a text file and catastrophic for a 60 MB export —
 * base64 in a WebView string is four bytes of heap per three bytes of video, on
 * a device that may be a 3 GB Android phone. Everything here moves bytes
 * through a 64 KB buffer and never holds a whole file in memory.
 */
public final class Transfers {

    private static final int BUFFER = 64 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 60_000;

    private Transfers() {}

    /** Progress across a multi-file transfer, 0..1. */
    public interface ProgressListener {
        void onProgress(double fraction);
    }

    /** Download one input to `destination`, streaming. */
    public static void download(String url, File destination, ProgressListener listener)
        throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("Download returned " + status);
            }
            long expected = connection.getContentLengthLong();
            long written = 0;
            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[BUFFER];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, count);
                    written += count;
                    if (listener != null && expected > 0) {
                        listener.onProgress(Math.min(1d, written / (double) expected));
                    }
                }
            }
            if (expected > 0 && written != expected) {
                // A truncated input is the failure that produces a video which
                // is "mostly right" — half a photo, a clip that stops early —
                // so it has to be caught here rather than at playback.
                throw new IOException(
                    "Download was truncated: " + written + " of " + expected + " bytes");
            }
        } finally {
            connection.disconnect();
        }
    }

    /** One uploaded part, as the completion endpoint wants it. */
    public static final class Part {
        public final int partNumber;
        public final String eTag;

        Part(int partNumber, String eTag) {
            this.partNumber = partNumber;
            this.eTag = eTag;
        }
    }

    /**
     * Upload a file to presigned part URLs, in order, streaming each slice.
     *
     * Parts are uploaded sequentially rather than in parallel: a phone on
     * mobile data gains little from concurrency and loses a lot when four
     * simultaneous uploads each stall, and sequential progress is honest
     * progress.
     */
    public static List<Part> uploadParts(
        File file,
        List<String> partUrls,
        long partSizeBytes,
        ProgressListener listener
    ) throws IOException {
        List<Part> parts = new ArrayList<>();
        long total = file.length();
        long sent = 0;

        try (java.io.RandomAccessFile source = new java.io.RandomAccessFile(file, "r")) {
            for (int index = 0; index < partUrls.size(); index++) {
                long offset = index * partSizeBytes;
                if (offset >= total) break;
                long length = Math.min(partSizeBytes, total - offset);

                HttpURLConnection connection =
                    (HttpURLConnection) new URL(partUrls.get(index)).openConnection();
                connection.setDoOutput(true);
                connection.setRequestMethod("PUT");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setFixedLengthStreamingMode(length);
                try {
                    source.seek(offset);
                    try (OutputStream output = connection.getOutputStream()) {
                        byte[] buffer = new byte[BUFFER];
                        long remaining = length;
                        while (remaining > 0) {
                            int count = source.read(buffer, 0, (int) Math.min(BUFFER, remaining));
                            if (count < 0) break;
                            output.write(buffer, 0, count);
                            remaining -= count;
                            sent += count;
                            if (listener != null && total > 0) {
                                listener.onProgress(Math.min(1d, sent / (double) total));
                            }
                        }
                    }
                    int status = connection.getResponseCode();
                    if (status < 200 || status >= 300) {
                        throw new IOException("Upload part " + (index + 1) + " returned " + status);
                    }
                    String eTag = connection.getHeaderField("ETag");
                    if (eTag == null || eTag.isEmpty()) {
                        // Without the ETag the multipart cannot be assembled, so
                        // this is fatal rather than something to paper over.
                        throw new IOException("Upload part " + (index + 1) + " returned no ETag");
                    }
                    parts.add(new Part(index + 1, eTag));
                } finally {
                    connection.disconnect();
                }
            }
        }
        return parts;
    }

    /** Upload a small file with a single presigned PUT — used for the cover. */
    public static void putFile(String url, File file, String contentType) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setDoOutput(true);
        connection.setRequestMethod("PUT");
        connection.setRequestProperty("Content-Type", contentType);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setFixedLengthStreamingMode(file.length());
        try (OutputStream output = connection.getOutputStream();
             InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[BUFFER];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
        } finally {
            int status;
            try {
                status = connection.getResponseCode();
            } catch (IOException error) {
                connection.disconnect();
                throw error;
            }
            connection.disconnect();
            if (status < 200 || status >= 300) {
                throw new IOException("Cover upload returned " + status);
            }
        }
    }

    /**
     * Extract the social poster from the FINISHED video.
     *
     * The requirement is specific and worth restating: the cover comes from the
     * export's own frames, never from a source photo. A poster taken from an
     * uploaded still would show something that is not in the video.
     */
    public static File extractCover(File video, double atSeconds, File destination)
        throws IOException {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(video.getAbsolutePath());
            long atUs = Math.max(0, Math.round(atSeconds * 1_000_000d));
            Bitmap frame = retriever.getFrameAtTime(atUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) {
                // A video shorter than the requested time still has a first
                // frame; falling back to it beats shipping an export with no
                // preview image anywhere it is surfaced.
                frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            }
            if (frame == null) throw new IOException("Could not read a frame for the cover");

            try (FileOutputStream output = new FileOutputStream(destination)) {
                frame.compress(Bitmap.CompressFormat.JPEG, 88, output);
            }
            frame.recycle();
            return destination;
        } finally {
            try {
                retriever.release();
            } catch (IOException ignored) {
                // release() is documented to throw on some API levels; a failed
                // release must not discard a cover we already wrote.
            }
        }
    }

    /** Duration of a media file in seconds; 0 when it cannot be read. */
    public static double durationSeconds(File file) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return value == null ? 0d : Long.parseLong(value) / 1000d;
        } catch (RuntimeException error) {
            return 0d;
        } finally {
            try { retriever.release(); } catch (IOException ignored) { }
        }
    }

    /** Whether a rendered file carries an audio track — the silence check. */
    public static boolean hasAudioTrack(File file) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            return "yes".equals(
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO));
        } catch (RuntimeException error) {
            return false;
        } finally {
            try { retriever.release(); } catch (IOException ignored) { }
        }
    }
}
