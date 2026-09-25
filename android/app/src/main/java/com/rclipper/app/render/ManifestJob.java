package com.rclipper.app.render;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;

import org.json.JSONException;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * One manifest render, start to finish, off the main thread.
 *
 * The plugin owns the Capacitor call and the lifecycle; this owns the work:
 * fetch what the stage needs, build the composition, export it, and — for a
 * final export — pull the cover out of the video that was just produced.
 *
 * PROGRESS IS WEIGHTED, NOT LINEAR. A phone export is perhaps a tenth
 * downloading and nine tenths encoding, so reporting the transformer's raw
 * percentage would sit at 0 for the whole download and then race. The weights
 * below are rough but honest, which is the point of a progress bar.
 */
@OptIn(markerClass = UnstableApi.class)
public final class ManifestJob {

    private static final double DOWNLOAD_SHARE = 0.15;
    private static final double RENDER_SHARE = 0.80;
    private static final long PROGRESS_POLL_MS = 500;

    public interface Callback {
        void onProgress(double percent);
        void onSuccess(Result result);
        /**
         * `message` is the root cause as one plain sentence; `log` is every
         * step and every failed attempt, for the person and for support.
         */
        void onFailure(String message, Exception error, java.util.List<String> log);
    }

    /** Everything the web layer needs to report the render and complete it. */
    public static final class Result {
        public File output;
        public File cover;
        public long fileSizeBytes;
        public double durationSeconds;
        public boolean hasAudioTrack;
        public int width;
        public int height;
        public boolean crossDissolved;
        /** The final export had to be made without the motion template. */
        public boolean templateDropped;
        public String stage;
    }

    private final Context context;
    private final File workDirectory;
    private final RenderManifest manifest;
    /** assetId (or "input"/"voice"/"music") → an already-staged local file. */
    private final Map<String, File> stagedSources;
    private final Callback callback;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private volatile Transformer transformer;
    private volatile boolean cancelled;
    private final Map<String, File> downloaded = new HashMap<>();
    private final RenderErrorLog log = new RenderErrorLog();

    public ManifestJob(
        Context context,
        File workDirectory,
        RenderManifest manifest,
        Map<String, File> stagedSources,
        Callback callback
    ) {
        this.context = context;
        this.workDirectory = workDirectory;
        this.manifest = manifest;
        this.stagedSources = stagedSources;
        this.callback = callback;
    }

    /**
     * Stop as soon as possible and clean up.
     *
     * Cancellation has to work at three different points — mid-download,
     * mid-export, and between the two — because the most common reason a phone
     * render is cancelled is the user leaving the screen, and a render that
     * keeps encoding in the background after that drains a battery for nothing.
     */
    public void cancel() {
        cancelled = true;
        Transformer active = transformer;
        if (active != null) {
            mainHandler.post(() -> {
                try {
                    active.cancel();
                } catch (RuntimeException ignored) {
                    // Cancelling an already-finished export throws; harmless.
                }
            });
        }
    }

    /** Run the whole stage. Call from a background thread. */
    public void run() {
        File output = null;
        try {
            log.note("Stage " + manifest.stage + " at " + manifest.width + "×" + manifest.height
                + ", " + manifest.fps + " fps, from originals: " + manifest.buildFromSources);
            Map<String, File> inputs = fetchInputs();
            if (cancelled) throw new InterruptedException();
            for (RenderManifest.Source source : manifest.sources) {
                log.describeInput(source.assetId, inputs.get(source.assetId), !source.isImage());
            }

            output = new File(workDirectory, java.util.UUID.randomUUID() + "-output.mp4");
            ManifestRenderer renderer = new ManifestRenderer(context);

            ManifestRenderer.Built built;
            boolean retriedWithHardCuts = false;
            boolean templateDropped = false;

            if (manifest.isMontage()) {
                ManifestRenderer.SourceResolver resolver = assetId -> {
                    File file = inputs.get(assetId);
                    if (file == null) throw new JSONException("Missing source " + assetId);
                    return file;
                };

                // BUILDING IS INSIDE THE TRY, NOT JUST EXPORTING. The
                // two-sequence dissolve can be refused before a single frame is
                // encoded — Media3 validates a sequence's gaps in
                // `EditedMediaItemSequence.build()` — and a build that threw out
                // here reached the requester as a raw library message ("If the
                // first item in the sequence is a Gap, then forceAudioTrack or
                // forceVideoTrack flag must be set") with no video to show for
                // it. Hard cuts are a real video; a failed render is not, and
                // that is just as true of a rejected composition as of a
                // rejected export.
                ManifestRenderer.Built dissolving = null;
                try {
                    dissolving = renderer.buildMontage(manifest, resolver, true);
                    built = dissolving;
                    export(built, output);
                } catch (Exception dissolveFailure) {
                    if (cancelled) throw dissolveFailure;
                    log.failure("Attempt with cross-dissolves", dissolveFailure);
                    if (dissolving != null) releaseOverlays(dissolving);
                    retriedWithHardCuts = true;
                    try {
                        built = renderer.buildMontage(manifest, resolver, false);
                        export(built, output);
                    } catch (Exception hardCutFailure) {
                        if (cancelled) throw hardCutFailure;
                        log.failure("Attempt with hard cuts", hardCutFailure);
                        // Last resort: plain cover-cropped framing. Report the
                        // FIRST failure if even this fails — it is the real one.
                        renderer.plainFraming = true;
                        try {
                            built = renderer.buildMontage(manifest, resolver, false);
                            export(built, output);
                        } catch (Exception plainFailure) {
                            if (cancelled) throw plainFailure;
                            log.failure("Attempt with plain framing (last resort)", plainFailure);
                            throw dissolveFailure;
                        }
                    }
                }
            } else if (manifest.buildFromSources) {
                // The master or the final straight from the originals, one
                // encode, nothing downloaded but the voice and the music.
                ManifestRenderer.SourceResolver resolver = assetId -> {
                    File file = inputs.get(assetId);
                    if (file == null) throw new JSONException("Missing source " + assetId);
                    return file;
                };
                File voice = requireInput(inputs, "voice", "the approved speaking voice");
                File music = inputs.get("music");
                if (manifest.audio.musicSelected && music == null) {
                    throw new IOException("The selected background music is missing");
                }

                double picture = manifest.pictureSeconds();
                double voiceLength = manifest.audio.voiceDurationSeconds != null
                    ? manifest.audio.voiceDurationSeconds
                    : Transfers.durationSeconds(voice);
                // max(picture, voice + lead-in), as the server's compose step:
                // the storyboard normally outlasts the narration, but a voice
                // that overruns is never clipped — the picture gets a black tail.
                final double total = Math.max(picture, voiceLength + manifest.audio.leadInSeconds);

                File mixed = new File(workDirectory, java.util.UUID.randomUUID() + "-mix.m4a");
                new AudioMixer(manifest.audio).mix(voice, music, total, mixed);
                if (cancelled) throw new InterruptedException();

                try {
                    if (manifest.isMaster()) {
                        // Dissolves first; hard cuts if this phone will not run them.
                        ManifestRenderer.Built dissolving = null;
                        try {
                            dissolving = renderer.buildMasterFromSources(
                                manifest, resolver, mixed, total, true);
                            built = dissolving;
                            export(built, output);
                        } catch (Exception dissolveFailure) {
                            if (cancelled) throw dissolveFailure;
                            log.failure("Attempt with cross-dissolves", dissolveFailure);
                            if (dissolving != null) releaseOverlays(dissolving);
                            retriedWithHardCuts = true;
                            try {
                                built = renderer.buildMasterFromSources(
                                    manifest, resolver, mixed, total, false);
                                export(built, output);
                            } catch (Exception hardCutFailure) {
                                if (cancelled) throw hardCutFailure;
                                log.failure("Attempt with hard cuts", hardCutFailure);
                                renderer.plainFraming = true;
                                try {
                                    built = renderer.buildMasterFromSources(
                                        manifest, resolver, mixed, total, false);
                                    export(built, output);
                                } catch (Exception plainFailure) {
                                    if (cancelled) throw plainFailure;
                                    log.failure("Attempt with plain framing (last resort)", plainFailure);
                                    throw dissolveFailure;
                                }
                            }
                        }
                    } else {
                        // Three attempts, each giving up the least important
                        // thing: the dissolves, then the template. Captions are
                        // content and are never dropped.
                        boolean[][] attempts = new boolean[][] {
                            { true, true },   // dissolves, template
                            { false, true },  // hard cuts, template
                            { false, false }, // hard cuts, no template
                        };
                        built = null;
                        Exception lastFailure = null;
                        for (boolean[] attempt : attempts) {
                            if (cancelled) throw new InterruptedException();
                            boolean dissolve = attempt[0];
                            boolean withTemplate = attempt[1];
                            if (!withTemplate && built != null && !built.templateIncluded) {
                                // Nothing left to drop.
                                break;
                            }
                            ManifestRenderer.Built candidate = null;
                            try {
                                candidate = renderer.buildFinalFromSources(
                                    manifest, resolver, mixed, total, dissolve, withTemplate);
                                built = candidate;
                                export(candidate, output);
                                lastFailure = null;
                                retriedWithHardCuts = !dissolve;
                                templateDropped = !withTemplate;
                                break;
                            } catch (Exception failure) {
                                if (cancelled) throw failure;
                                log.failure("Final-part attempt (dissolves " + dissolve + ", template " + withTemplate + ")", failure);
                                if (candidate != null) releaseOverlays(candidate);
                                lastFailure = failure;
                            }
                        }
                        if (lastFailure != null) {
                            // Last resort: plain cover-cropped framing, hard
                            // cuts, with the template. Report the original
                            // failure if even this does not work.
                            renderer.plainFraming = true;
                            ManifestRenderer.Built plain = null;
                            try {
                                plain = renderer.buildFinalFromSources(
                                    manifest, resolver, mixed, total, false, true);
                                built = plain;
                                export(plain, output);
                                retriedWithHardCuts = true;
                                templateDropped = false;
                                lastFailure = null;
                            } catch (Exception plainFailure) {
                                if (cancelled) throw plainFailure;
                                log.failure("Attempt with plain framing (last resort)", plainFailure);
                                if (plain != null) releaseOverlays(plain);
                            }
                        }
                        if (lastFailure != null) throw lastFailure;
                        if (built == null) throw new IOException("The final export could not be built");
                    }
                } finally {
                    mixed.delete();
                }
            } else if (manifest.isMaster()) {
                File montage = requireInput(inputs, "input", "the approved montage");
                File voice = requireInput(inputs, "voice", "the approved speaking voice");
                File music = inputs.get("music");

                double picture = Transfers.durationSeconds(montage);
                double voiceLength = manifest.audio.voiceDurationSeconds != null
                    ? manifest.audio.voiceDurationSeconds
                    : Transfers.durationSeconds(voice);
                // The export runs for max(picture, voice + lead-in): the montage
                // normally outlasts the narration, but a voice that overruns
                // must never be clipped.
                double total = Math.max(picture, voiceLength + manifest.audio.leadInSeconds);

                File mixed = new File(workDirectory, java.util.UUID.randomUUID() + "-mix.m4a");
                new AudioMixer(manifest.audio).mix(voice, music, total, mixed);
                if (cancelled) throw new InterruptedException();

                built = renderer.buildMaster(manifest, montage, mixed);
                export(built, output);
                mixed.delete();
            } else {
                File master = requireInput(inputs, "input", "the approved merged master");
                // THE FINAL STAGE FALLS BACK TOO. Two bitmap overlays over a
                // decoded 1080p master is the heaviest GPU work this renderer
                // does, and it is where cheaper chipsets fail — a decoder that
                // cannot keep up, or a GL context that will not allocate. The
                // captions are content; the template is decoration. So a failed
                // export is retried once with the template dropped, and the
                // result says so, rather than losing the whole video.
                ManifestRenderer.Built withTemplate = null;
                try {
                    withTemplate = renderer.buildFinal(manifest, master, true);
                    built = withTemplate;
                    export(built, output);
                } catch (Exception overlayFailure) {
                    if (cancelled || withTemplate == null || !withTemplate.templateIncluded) {
                        throw overlayFailure;
                    }
                    releaseOverlays(withTemplate);
                    templateDropped = true;
                    built = renderer.buildFinal(manifest, master, false);
                    export(built, output);
                }
            }

            releaseOverlays(built);
            if (cancelled) throw new InterruptedException();

            Result result = new Result();
            result.output = output;
            result.fileSizeBytes = output.length();
            result.durationSeconds = Transfers.durationSeconds(output);
            result.hasAudioTrack = Transfers.hasAudioTrack(output);
            result.width = manifest.width;
            result.height = manifest.height;
            result.crossDissolved = built.crossDissolved && !retriedWithHardCuts;
            result.templateDropped = templateDropped;
            result.stage = manifest.stage;

            if (result.fileSizeBytes <= 0) {
                throw new IOException("The export produced no bytes");
            }
            if (!manifest.isMontage() && !result.hasAudioTrack) {
                // The specific failure that kept the draft renderer from
                // shipping. Catching it here means the phone says so, instead of
                // uploading a silent file for the server to reject.
                throw new IOException(
                    "The export came out silent; the approved voice was not mixed in");
            }

            if (manifest.coverRequired) {
                report(95);
                File cover = new File(workDirectory, java.util.UUID.randomUUID() + "-cover.jpg");
                result.cover = Transfers.extractCover(output, manifest.coverAtSeconds, cover);
            }

            cleanupDownloads();
            report(100);
            log.note("Finished: " + String.format(java.util.Locale.US, "%.1fs of video, %.1f MB",
                result.durationSeconds, result.fileSizeBytes / 1_000_000d));
            callback.onSuccess(result);
        } catch (InterruptedException cancellation) {
            cleanupDownloads();
            if (output != null) output.delete();
            callback.onFailure("Render cancelled", null, log.lines());
        } catch (Exception error) {
            cleanupDownloads();
            if (output != null) output.delete();
            // The FIRST failure is the root cause; what reached here is usually
            // the last fallback giving up, or the re-thrown first failure.
            Throwable root = log.lastFailure() != null ? log.lastFailure() : error;
            if (log.lastFailure() == null) log.failure("Render", error);
            else log.note("Gave up after the attempts above.");
            callback.onFailure(RenderErrorLog.diagnose(root), error, log.lines());
        }
    }

    // ── inputs ──────────────────────────────────────────────────────────────

    private File requireInput(Map<String, File> inputs, String key, String label)
        throws IOException {
        File file = inputs.get(key);
        if (file == null || !file.isFile()) {
            throw new IOException("This render needs " + label + ", which is not available");
        }
        return file;
    }

    /**
     * Resolve everything the stage reads.
     *
     * A source with a `localId` is already on this phone — the whole point of
     * the local-first path is that its original bytes were never uploaded, so it
     * is used in place and never fetched. Everything else is a short-lived,
     * object-scoped URL the server signed for this attempt.
     */
    private Map<String, File> fetchInputs() throws IOException, InterruptedException, JSONException {
        Map<String, File> inputs = new HashMap<>(stagedSources);

        int total = 0;
        for (RenderManifest.Source source : manifest.sources) {
            if (source.url != null && !inputs.containsKey(source.assetId)) total++;
        }
        if (manifest.inputVideoUrl != null && !inputs.containsKey("input")) total++;
        if (manifest.voiceUrl != null && !inputs.containsKey("voice")) total++;
        if (manifest.musicUrl != null && !inputs.containsKey("music")) total++;

        int done = 0;
        for (RenderManifest.Source source : manifest.sources) {
            if (cancelled) throw new InterruptedException();
            if (inputs.containsKey(source.assetId)) continue;
            if (source.url == null) {
                throw new JSONException(
                    "Source " + source.assetId + " is device-private but was not staged");
            }
            File file = fetch(source.url, source.assetId, extensionFor(source.mimeType));
            inputs.put(source.assetId, file);
            report(share(++done, total, DOWNLOAD_SHARE));
        }

        if (manifest.inputVideoUrl != null && !inputs.containsKey("input")) {
            if (cancelled) throw new InterruptedException();
            inputs.put("input", fetch(manifest.inputVideoUrl, "input", "mp4"));
            report(share(++done, total, DOWNLOAD_SHARE));
        }
        if (manifest.voiceUrl != null && !inputs.containsKey("voice")) {
            if (cancelled) throw new InterruptedException();
            inputs.put("voice", fetch(manifest.voiceUrl, "voice", "m4a"));
            report(share(++done, total, DOWNLOAD_SHARE));
        }
        if (manifest.musicUrl != null && !inputs.containsKey("music")) {
            if (cancelled) throw new InterruptedException();
            inputs.put("music", fetch(manifest.musicUrl, "music", "mp3"));
            report(share(++done, total, DOWNLOAD_SHARE));
        }
        return inputs;
    }

    private File fetch(String url, String label, String extension) throws IOException {
        if (url.startsWith("file://")) {
            File local = new File(Uri.parse(url).getPath());
            if (!local.isFile()) throw new IOException("Staged file for " + label + " is missing");
            return local;
        }
        File destination = new File(
            workDirectory, java.util.UUID.randomUUID() + "-in-" + label + "." + extension);
        Transfers.download(url, destination, null);
        downloaded.put(label, destination);
        return destination;
    }

    private static String extensionFor(String mimeType) {
        if (mimeType == null) return "bin";
        if (mimeType.startsWith("video/")) return "mp4";
        if (mimeType.contains("png")) return "png";
        if (mimeType.contains("webp")) return "webp";
        if (mimeType.startsWith("image/")) return "jpg";
        if (mimeType.startsWith("audio/")) return "m4a";
        return "bin";
    }

    private void cleanupDownloads() {
        // Downloaded inputs are this attempt's alone; staged local sources are
        // the user's originals and belong to the web layer, so they are never
        // touched here.
        for (File file : downloaded.values()) {
            if (file != null && file.isFile()) file.delete();
        }
        downloaded.clear();
    }

    // ── export ──────────────────────────────────────────────────────────────

    private void export(ManifestRenderer.Built built, File output) throws Exception {
        final Object lock = new Object();
        final Exception[] failure = new Exception[1];
        final boolean[] finished = new boolean[1];

        mainHandler.post(() -> {
            try {
                Transformer built2 = new Transformer.Builder(context)
                    // Encode a portrait video AS portrait. By default Media3
                    // turns portrait frames sideways before encoding and tags
                    // the file with a 90° rotation; players cope, but the file
                    // is then 1920x1080 as stored, which is not what anyone
                    // asked for and what a size check sees. (Media3 still falls
                    // back to the rotated form on an encoder that cannot take a
                    // portrait frame; the server check reads the rotation.)
                    .setPortraitEncodingEnabled(true)
                    .setVideoMimeType(ManifestRenderer.videoMimeType())
                    .setAudioMimeType(ManifestRenderer.audioMimeType())
                    .addListener(new Transformer.Listener() {
                        @Override
                        public void onCompleted(Composition composition, ExportResult result) {
                            synchronized (lock) {
                                finished[0] = true;
                                lock.notifyAll();
                            }
                        }

                        @Override
                        public void onError(
                            Composition composition, ExportResult result, ExportException error
                        ) {
                            synchronized (lock) {
                                failure[0] = error;
                                finished[0] = true;
                                lock.notifyAll();
                            }
                        }
                    })
                    .build();
                transformer = built2;
                log.note(String.format(java.util.Locale.US,
                    "Encoding %.1fs (%s, cross-dissolves %s, template %s)",
                    built.durationSeconds, ManifestRenderer.videoMimeType(),
                    built.crossDissolved, built.templateIncluded));
                built2.start(built.composition, output.getAbsolutePath());
                pollProgress(built2);
            } catch (RuntimeException error) {
                synchronized (lock) {
                    failure[0] = error;
                    finished[0] = true;
                    lock.notifyAll();
                }
            }
        });

        synchronized (lock) {
            while (!finished[0]) lock.wait();
        }
        transformer = null;
        if (failure[0] != null) throw failure[0];
        if (cancelled) throw new InterruptedException();
    }

    private void pollProgress(Transformer active) {
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (transformer != active) return;
                ProgressHolder holder = new ProgressHolder();
                if (active.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                    report(DOWNLOAD_SHARE * 100 + holder.progress * RENDER_SHARE);
                }
                mainHandler.postDelayed(this, PROGRESS_POLL_MS);
            }
        }, PROGRESS_POLL_MS);
    }

    private void releaseOverlays(ManifestRenderer.Built built) {
        for (Runnable release : built.cleanup) {
            try {
                release.run();
            } catch (RuntimeException ignored) {
                // A bitmap that failed to recycle is a leak until the process
                // ends, not a reason to discard a finished render.
            }
        }
    }

    private static double share(int done, int total, double weight) {
        if (total <= 0) return weight * 100;
        return (done / (double) total) * weight * 100;
    }

    private void report(double percent) {
        callback.onProgress(Math.max(0, Math.min(100, percent)));
    }

    private static String describe(Exception error) {
        String message = error.getMessage();
        if (message != null && !message.isEmpty()) return message;
        return error.getClass().getSimpleName();
    }
}
