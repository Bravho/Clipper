package com.rclipper.app;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.StatFs;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.C;
import androidx.media3.common.audio.DefaultGainProvider;
import androidx.media3.common.audio.GainProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.ProgressHolder;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.ArrayList;
import java.util.List;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import java.util.HashMap;
import java.util.Map;

import com.rclipper.app.render.ManifestJob;
import com.rclipper.app.render.RenderManifest;
import com.rclipper.app.render.Transfers;

/** First native rendering primitive: download a completed master and encode it locally. */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "DeviceVideoRender")
public class DeviceVideoRenderPlugin extends Plugin {
    private final ExecutorService transfers = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Transformer activeTransformer;
    private PluginCall activeCall;
    private File activeInput;
    private File activeOutput;
    private Runnable progressPoll;
    private File stagedSource;

    @PluginMethod
    public void capabilities(PluginCall call) {
        StatFs stats = new StatFs(getContext().getCacheDir().getAbsolutePath());
        JSObject result = new JSObject();
        // v5 adds renderManifest/uploadOutput: the complete phone editor path.
        // The web layer checks this before offering to render a real job, so an
        // installed v4 build keeps working as a local draft tester and is never
        // handed production work it cannot finish.
        // v6 renders a master or final straight from the originals in one
        // encode (`buildFromSources`) and draws the styled render's templates
        // and captions (remotion/TemplatedVideo.tsx). The server only sends a
        // from-sources manifest to 6+, so a v5 build keeps the download path.
        result.put("nativePluginVersion", 6);
        result.put("freeBytes", stats.getAvailableBytes());
        result.put("supportsH264Encode", hasEncoder(MimeTypes.VIDEO_H264));
        result.put("supportsAacEncode", hasEncoder(MimeTypes.AUDIO_AAC));
        call.resolve(result);
    }

    private boolean hasEncoder(String mimeType) {
        MediaCodecInfo[] codecs = new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos();
        for (MediaCodecInfo codec : codecs) {
            if (!codec.isEncoder()) continue;
            for (String supported : codec.getSupportedTypes()) {
                if (mimeType.equalsIgnoreCase(supported)) return true;
            }
        }
        return false;
    }

    @PluginMethod
    public void renderMaster(PluginCall call) {
        String sourceUrl = call.getString("sourceUrl");
        if (sourceUrl == null || (!sourceUrl.startsWith("https://") && !sourceUrl.startsWith("file://"))) {
            call.reject("A HTTPS or staged file URL is required");
            return;
        }
        synchronized (this) {
            if (activeCall != null) {
                call.reject("Another device render is already active");
                return;
            }
            File dir = new File(getContext().getCacheDir(), "device-render");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Cannot create render directory");
                return;
            }
            String id = UUID.randomUUID().toString();
            activeInput = new File(dir, id + "-input.mp4");
            activeOutput = new File(dir, id + "-output.mp4");
            activeCall = call;
        }
        final File inputFile = activeInput;
        transfers.execute(() -> {
            try {
                if (sourceUrl.startsWith("https://")) download(sourceUrl, inputFile);
                else copyStagedSource(sourceUrl, inputFile);
                getActivity().runOnUiThread(() -> {
                    if (activeCall == call) startExport(call);
                    else inputFile.delete();
                });
            } catch (Exception error) {
                getActivity().runOnUiThread(() -> {
                    if (activeCall == call) {
                        cleanupAll();
                        activeCall = null;
                        call.reject("Could not prepare the video", error);
                    }
                });
            }
        });
    }

    /** Hard-join real moving clips without their camera audio. */
    @PluginMethod
    public void renderLocalTimeline(PluginCall call) {
        JSONArray clips = call.getArray("clips");
        Integer width = call.getInt("width");
        Integer height = call.getInt("height");
        if (clips == null || clips.length() < 1 || clips.length() > 10 ||
                width == null || height == null || width < 1 || height < 1 ||
                width > 1920 || height > 1920) {
            call.reject("Invalid local timeline");
            return;
        }
        synchronized (this) {
            if (activeCall != null) { call.reject("Another device render is already active"); return; }
            try {
                activeOutput = new File(renderDirectory(), UUID.randomUUID() + "-output.mp4");
                activeCall = call;
            } catch (Exception error) { call.reject("Cannot create render directory", error); return; }
        }
        try {
            List<EditedMediaItem> items = new ArrayList<>();
            for (int i = 0; i < clips.length(); i++) {
                JSONObject clip = clips.getJSONObject(i);
                String raw = clip.getString("sourceUrl");
                if (!raw.startsWith("file://")) throw new Exception("Only staged local clips are allowed");
                File source = new File(Uri.parse(raw).getPath()).getCanonicalFile();
                if (!renderDirectory().equals(source.getParentFile()) ||
                        !source.getName().matches("[0-9a-fA-F-]+-source\\.(bin|mp3|m4a|wav|mp4)") || !source.isFile()) {
                    throw new Exception("Invalid staged source path");
                }
                double start = clip.getDouble("startSeconds");
                double duration = clip.getDouble("durationSeconds");
                if (!Double.isFinite(start) || !Double.isFinite(duration) || start < 0 || duration <= 0) {
                    throw new Exception("Invalid clip trim");
                }
                MediaItem item = new MediaItem.Builder()
                    .setUri(Uri.fromFile(source))
                    .setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(Math.round(start * 1000))
                        .setEndPositionMs(Math.round((start + duration) * 1000))
                        .build())
                    .build();
                items.add(new EditedMediaItem.Builder(item).setRemoveAudio(true).build());
            }
            Composition composition = new Composition.Builder(
                EditedMediaItemSequence.withVideoFrom(items)
            ).setEffects(new Effects(
                Collections.emptyList(),
                Collections.singletonList(Presentation.createForWidthAndHeight(
                    width, height, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP
                ))
            )).build();
            getActivity().runOnUiThread(() -> startExport(call, composition));
        } catch (Exception error) {
            cleanupAll();
            activeCall = null;
            call.reject("Could not compose the local clips", error);
        }
    }

    /**
     * v6: a light preview copy of a staged clip — 720 px on the short side,
     * H.264, no sound — for the in-app browser, which often cannot decode what
     * a phone camera records (HEVC, 10-bit HDR, 4K60). The phone's own decoder
     * usually can; this turns the clip into something the storyboard and the
     * trimmer can play. Preview only: the original is what gets rendered.
     */
    @PluginMethod
    public void makePreviewProxy(PluginCall call) {
        synchronized (this) {
            if (activeCall != null) {
                call.reject("Another device render is already active");
                return;
            }
        }
        try {
            File source = validRenderInput(call.getString("sourceUrl"));
            synchronized (this) {
                activeOutput = new File(renderDirectory(), UUID.randomUUID() + "-output.mp4");
                activeCall = call;
            }
            EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(source)))
                .setRemoveAudio(true)
                .build();
            Composition composition = new Composition.Builder(
                EditedMediaItemSequence.withVideoFrom(Collections.singletonList(item))
            ).setEffects(new Effects(
                Collections.emptyList(),
                Collections.singletonList(Presentation.createForShortSide(720))
            )).build();
            getActivity().runOnUiThread(() -> startExport(call, composition));
        } catch (Exception error) {
            cleanupAll();
            activeCall = null;
            call.reject("Could not make a preview copy of this clip", error);
        }
    }

    /** Audible local draft. The montage's source audio is deliberately discarded. */
    @PluginMethod
    public void renderAudioDraft(PluginCall call) {
        String masterPath = call.getString("masterPath");
        String voiceUrl = call.getString("voiceUrl");
        String musicUrl = call.getString("musicUrl");
        try {
            File dir = renderDirectory();
            File master = new File(masterPath == null ? "" : masterPath).getCanonicalFile();
            if (!dir.equals(master.getParentFile()) || !master.getName().endsWith("-output.mp4") || !master.isFile()) {
                throw new Exception("Invalid local montage");
            }
            File voice = validStagedFile(voiceUrl);
            File music = musicUrl == null ? null : validStagedFile(musicUrl);
            long masterMs = durationMs(master);
            long voiceMs = durationMs(voice);
            if (masterMs <= 600 || voiceMs <= 0) throw new Exception("Invalid montage or speaking voice duration");
            EditedMediaItem videoItem = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(master)))
                .setRemoveAudio(true).build();
            EditedMediaItemSequence video = EditedMediaItemSequence.withVideoFrom(Collections.singletonList(videoItem));
            EditedMediaItemSequence.Builder voiceBuilder = new EditedMediaItemSequence.Builder(
                Collections.singleton(C.TRACK_TYPE_AUDIO));
            voiceBuilder.addGap(600_000L);
            MediaItem voiceItem = new MediaItem.Builder()
                .setUri(Uri.fromFile(voice))
                .setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                    .setEndPositionMs(Math.min(voiceMs, masterMs - 600)).build())
                .build();
            voiceBuilder.addItem(new EditedMediaItem.Builder(voiceItem).build());
            List<EditedMediaItemSequence> sequences = new ArrayList<>();
            sequences.add(video);
            sequences.add(voiceBuilder.build());
            if (music != null) {
                EditedMediaItem musicItem = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(music)))
                    .setEffects(new Effects(
                        Collections.singletonList(new GainProcessor(new DefaultGainProvider.Builder(0.3f).build())),
                        Collections.emptyList()))
                    .build();
                sequences.add(EditedMediaItemSequence.withAudioFrom(Collections.singletonList(musicItem))
                    .buildUpon().setIsLooping(true).build());
            }
            Composition composition = new Composition.Builder(sequences).build();
            synchronized (this) {
                if (activeCall != null) { call.reject("Another device render is already active"); return; }
                activeOutput = new File(dir, UUID.randomUUID() + "-output.mp4");
                activeCall = call;
            }
            getActivity().runOnUiThread(() -> startExport(call, composition));
        } catch (Exception error) {
            call.reject("Could not prepare audible draft", error);
        }
    }

    /**
     * A file a manifest render may read: a staged copy of a device-private
     * original, OR a previous stage's output being chained into the next one.
     *
     * Both live in this plugin's render directory and nowhere else, which is the
     * guarantee worth keeping — the file NAME is a convenience, the parent
     * directory check is the security boundary.
     */
    private File validRenderInput(String raw) throws Exception {
        if (raw == null || !raw.startsWith("file://")) throw new Exception("Missing staged source");
        File file = new File(Uri.parse(raw).getPath()).getCanonicalFile();
        boolean named = file.getName().matches("[0-9a-fA-F-]+-source\\.(bin|mp3|m4a|wav|mp4)")
            || file.getName().matches("[0-9a-fA-F-]+-output\\.mp4")
            || file.getName().matches("[0-9a-fA-F-]+-mix\\.m4a");
        if (!renderDirectory().equals(file.getParentFile()) || !named || !file.isFile()) {
            throw new Exception("Invalid staged source path");
        }
        return file;
    }

    private File validStagedFile(String raw) throws Exception {
        if (raw == null || !raw.startsWith("file://")) throw new Exception("Missing staged audio");
        File file = new File(Uri.parse(raw).getPath()).getCanonicalFile();
        if (!renderDirectory().equals(file.getParentFile()) ||
                !file.getName().matches("[0-9a-fA-F-]+-source\\.(mp3|m4a|wav|mp4)") || !file.isFile()) {
            throw new Exception("Invalid staged audio");
        }
        return file;
    }

    private long durationMs(File file) throws Exception {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (value == null) throw new Exception("Media duration is unavailable");
            return Long.parseLong(value);
        } finally { retriever.release(); }
    }

    private File renderDirectory() throws Exception {
        File dir = new File(getContext().getCacheDir(), "device-render").getCanonicalFile();
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create render directory");
        return dir;
    }

    @PluginMethod
    public synchronized void beginLocalSource(PluginCall call) {
        try {
            if (stagedSource != null) { call.reject("A local source is already being staged"); return; }
            String extension = call.getString("extension", "bin");
            if (!extension.matches("bin|mp3|m4a|wav|mp4")) { call.reject("Unsupported staged media type"); return; }
            stagedSource = new File(renderDirectory(), UUID.randomUUID() + "-source." + extension);
            if (!stagedSource.createNewFile()) throw new Exception("Could not create staged source");
            call.resolve();
        } catch (Exception error) { stagedSource = null; call.reject("Could not begin local source", error); }
    }

    @PluginMethod
    public synchronized void appendLocalSource(PluginCall call) {
        String data = call.getString("dataBase64");
        if (stagedSource == null || data == null) { call.reject("No active local source"); return; }
        try (FileOutputStream output = new FileOutputStream(stagedSource, true)) {
            output.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception error) { call.reject("Could not append local source", error); }
    }

    @PluginMethod
    public synchronized void finishLocalSource(PluginCall call) {
        if (stagedSource == null) { call.reject("No active local source"); return; }
        JSObject result = new JSObject();
        result.put("sourceUrl", Uri.fromFile(stagedSource).toString());
        result.put("fileSizeBytes", stagedSource.length());
        stagedSource = null;
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void abortLocalSource(PluginCall call) {
        if (stagedSource != null) stagedSource.delete();
        stagedSource = null;
        call.resolve();
    }

    private void copyStagedSource(String sourceUrl, File destination) throws Exception {
        File source = new File(Uri.parse(sourceUrl).getPath()).getCanonicalFile();
        File dir = renderDirectory();
        if (!dir.equals(source.getParentFile()) || !source.getName().matches("[0-9a-fA-F-]+-source\\.(bin|mp3|m4a|wav|mp4)")) {
            throw new Exception("Invalid staged source path");
        }
        try (InputStream input = new java.io.FileInputStream(source);
             FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
        }
    }

    @PluginMethod
    public void releaseLocalSource(PluginCall call) {
        String raw = call.getString("sourceUrl");
        try {
            if (raw == null || !raw.startsWith("file://")) throw new Exception("Missing source URL");
            File source = new File(Uri.parse(raw).getPath()).getCanonicalFile();
            File dir = renderDirectory();
            if (!dir.equals(source.getParentFile()) || !source.getName().matches("[0-9a-fA-F-]+-source\\.(bin|mp3|m4a|wav|mp4)")) {
                throw new Exception("Invalid staged source path");
            }
            if (source.exists() && !source.delete()) throw new Exception("Could not remove staged source");
            call.resolve();
        } catch (Exception error) { call.reject("Could not release local source", error); }
    }

    private void download(String sourceUrl, File destination) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        try {
            if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) {
                throw new Exception("Download returned " + connection.getResponseCode());
            }
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            }
        } finally {
            connection.disconnect();
        }
    }

    private void startExport(PluginCall call) {
        startExport(call, null);
    }

    private void startExport(PluginCall call, Composition timeline) {
        try {
            activeTransformer = new Transformer.Builder(getContext())
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .addListener(new Transformer.Listener() {
                    @Override
                    public void onCompleted(Composition composition, ExportResult result) {
                        if (activeCall != call) return;
                        stopProgressPoll();
                        JSObject response = new JSObject();
                        response.put("path", activeOutput.getAbsolutePath());
                        response.put("fileSizeBytes", activeOutput.length());
                        cleanupInput();
                        activeCall = null;
                        call.resolve(response);
                    }

                    @Override
                    public void onError(Composition composition, ExportResult result, ExportException error) {
                        if (activeCall != call) return;
                        stopProgressPoll();
                        cleanupAll();
                        activeCall = null;
                        call.reject("Device video export failed", error);
                    }
                }).build();
            if (timeline == null) {
                activeTransformer.start(MediaItem.fromUri(Uri.fromFile(activeInput)), activeOutput.getAbsolutePath());
            } else {
                activeTransformer.start(timeline, activeOutput.getAbsolutePath());
            }
            progressPoll = new Runnable() {
                @Override public void run() {
                    if (activeCall != call || activeTransformer == null) return;
                    ProgressHolder progress = new ProgressHolder();
                    if (activeTransformer.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) {
                        JSObject event = new JSObject();
                        event.put("percent", progress.progress);
                        notifyListeners("renderProgress", event);
                    }
                    mainHandler.postDelayed(this, 500);
                }
            };
            mainHandler.post(progressPoll);
        } catch (Exception error) {
            cleanupAll();
            activeCall = null;
            stopProgressPoll();
            call.reject("Could not start device export", error);
        }
    }

    // ── v5: the complete manifest render path ───────────────────────────────

    /** The manifest render in flight, so cancel() can reach it. */
    private ManifestJob activeManifestJob;
    /**
     * Outputs a manifest render produced, kept until the web layer releases
     * them. Concurrent because it is written on the transfer thread when a
     * render finishes and read on the WebView thread when one is uploaded.
     */
    private final Map<String, File> manifestOutputs = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * Render one stage of a server-issued manifest.
     *
     * `stagedSources` maps a manifest source's assetId — or the reserved keys
     * "input", "voice" and "music" — to a file this plugin already staged. That
     * is how device-private originals reach the renderer without ever being
     * uploaded: the web layer copies them out of its private storage into the
     * plugin's cache, and the manifest names them by `localId` instead of a URL.
     */
    @PluginMethod
    public void renderManifest(PluginCall call) {
        String manifestJson = call.getString("manifest");
        if (manifestJson == null) { call.reject("A render manifest is required"); return; }

        final RenderManifest manifest;
        try {
            manifest = RenderManifest.parse(manifestJson);
        } catch (Exception error) {
            call.reject("This render manifest cannot be rendered by this app build", error);
            return;
        }

        final Map<String, File> staged = new HashMap<>();
        try {
            JSONArray entries = call.getArray("stagedSources");
            if (entries != null) {
                for (int i = 0; i < entries.length(); i++) {
                    JSONObject entry = entries.getJSONObject(i);
                    staged.put(entry.getString("key"), validRenderInput(entry.getString("sourceUrl")));
                }
            }
        } catch (Exception error) {
            call.reject("A staged source path is not valid", error);
            return;
        }

        final File workDirectory;
        synchronized (this) {
            if (activeCall != null || activeManifestJob != null) {
                call.reject("Another device render is already active");
                return;
            }
            try {
                workDirectory = renderDirectory();
            } catch (Exception error) {
                call.reject("Cannot create render directory", error);
                return;
            }
            activeCall = call;
        }

        ManifestJob job = new ManifestJob(getContext(), workDirectory, manifest, staged,
            new ManifestJob.Callback() {
                @Override
                public void onProgress(double percent) {
                    JSObject event = new JSObject();
                    event.put("percent", percent);
                    notifyListeners("renderProgress", event);
                }

                @Override
                public void onSuccess(ManifestJob.Result result) {
                    synchronized (DeviceVideoRenderPlugin.this) {
                        activeManifestJob = null;
                        if (activeCall != call) { result.output.delete(); return; }
                        activeCall = null;
                    }
                    manifestOutputs.put(result.output.getAbsolutePath(), result.output);
                    JSObject response = new JSObject();
                    response.put("path", result.output.getAbsolutePath());
                    response.put("fileSizeBytes", result.fileSizeBytes);
                    response.put("durationSeconds", result.durationSeconds);
                    response.put("hasAudioTrack", result.hasAudioTrack);
                    response.put("width", result.width);
                    response.put("height", result.height);
                    response.put("stage", result.stage);
                    // Reported so a comparison against the Mac export is never
                    // guesswork: a montage that fell back to hard cuts looks
                    // different, and the tester needs to know which they have.
                    response.put("crossDissolved", result.crossDissolved);
                    response.put("templateDropped", result.templateDropped);
                    if (result.cover != null) {
                        manifestOutputs.put(result.cover.getAbsolutePath(), result.cover);
                        response.put("coverPath", result.cover.getAbsolutePath());
                    }
                    call.resolve(response);
                }

                @Override
                public void onFailure(String message, Exception error) {
                    synchronized (DeviceVideoRenderPlugin.this) {
                        activeManifestJob = null;
                        if (activeCall != call) return;
                        activeCall = null;
                    }
                    if (error == null) call.reject(message);
                    else call.reject(message, error);
                }
            });

        synchronized (this) { activeManifestJob = job; }
        transfers.execute(job::run);
    }

    /**
     * Upload a finished render straight to object storage.
     *
     * The part URLs are presigned by the server for the one key this attempt
     * was given, so the phone cannot choose where its export lands. Bytes are
     * streamed from disk a part at a time — a 60 MB export never exists in the
     * WebView's heap, which is what `nativeDownload`'s base64 path would have
     * required.
     */
    @PluginMethod
    public void uploadOutput(PluginCall call) {
        String path = call.getString("path");
        JSONArray partUrls = call.getArray("partUrls");
        Integer partSize = call.getInt("partSizeBytes");
        String coverPath = call.getString("coverPath");
        String coverUrl = call.getString("coverUrl");

        if (path == null || partUrls == null || partUrls.length() == 0 || partSize == null || partSize <= 0) {
            call.reject("An output path and presigned part URLs are required");
            return;
        }

        transfers.execute(() -> {
            try {
                File output = manifestOutputs.get(path);
                if (output == null || !output.isFile()) {
                    File candidate = new File(path).getCanonicalFile();
                    if (!renderDirectory().equals(candidate.getParentFile()) || !candidate.isFile()) {
                        throw new Exception("Invalid output path");
                    }
                    output = candidate;
                }

                java.util.List<String> urls = new java.util.ArrayList<>();
                for (int i = 0; i < partUrls.length(); i++) urls.add(partUrls.getString(i));

                java.util.List<Transfers.Part> parts = Transfers.uploadParts(
                    output, urls, partSize.longValue(),
                    fraction -> {
                        JSObject event = new JSObject();
                        event.put("percent", fraction * 100);
                        notifyListeners("uploadProgress", event);
                    });

                if (coverPath != null && coverUrl != null) {
                    File cover = manifestOutputs.get(coverPath);
                    if (cover != null && cover.isFile()) {
                        Transfers.putFile(coverUrl, cover, "image/jpeg");
                    }
                }

                JSONArray result = new JSONArray();
                for (Transfers.Part part : parts) {
                    JSONObject entry = new JSONObject();
                    entry.put("partNumber", part.partNumber);
                    entry.put("eTag", part.eTag);
                    result.put(entry);
                }
                JSObject response = new JSObject();
                response.put("parts", result);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Could not upload the rendered video", error);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        // A manifest job may be mid-download or mid-export on the transfer
        // thread; it is told to stop before the UI-thread teardown below, so a
        // cancelled render stops encoding rather than finishing in the
        // background and draining the battery for an output nobody wants.
        ManifestJob job;
        synchronized (this) { job = activeManifestJob; activeManifestJob = null; }
        if (job != null) job.cancel();

        getActivity().runOnUiThread(() -> {
            PluginCall renderCall = activeCall;
            activeCall = null;
            stopProgressPoll();
            if (activeTransformer != null) activeTransformer.cancel();
            cleanupAll();
            if (renderCall != null) renderCall.reject("Device render cancelled");
            call.resolve();
        });
    }

    private synchronized void cleanupInput() {
        if (activeInput != null) activeInput.delete();
        activeInput = null;
        activeTransformer = null;
    }

    private synchronized void cleanupAll() {
        if (activeOutput != null) activeOutput.delete();
        activeOutput = null;
        cleanupInput();
    }

    private void stopProgressPoll() {
        if (progressPoll != null) mainHandler.removeCallbacks(progressPoll);
        progressPoll = null;
    }

    @PluginMethod
    public void releaseOutput(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("Missing output path"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "device-render").getCanonicalFile();
            File file = new File(path).getCanonicalFile();
            boolean isRenderOutput = file.getName().endsWith("-output.mp4")
                || file.getName().endsWith("-cover.jpg");
            if (!dir.equals(file.getParentFile()) || !isRenderOutput) {
                call.reject("Invalid output path");
                return;
            }
            if (file.exists() && !file.delete()) {
                call.reject("Could not remove output file");
                return;
            }
            manifestOutputs.remove(file.getAbsolutePath());
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not remove output file", error);
        }
    }
}
