package com.rclipper.app;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.Uri;
import android.os.StatFs;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.Composition;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
        result.put("nativePluginVersion", 2);
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
            if (activeInput != null) {
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

    private File renderDirectory() throws Exception {
        File dir = new File(getContext().getCacheDir(), "device-render").getCanonicalFile();
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create render directory");
        return dir;
    }

    @PluginMethod
    public synchronized void beginLocalSource(PluginCall call) {
        try {
            if (stagedSource != null) { call.reject("A local source is already being staged"); return; }
            stagedSource = new File(renderDirectory(), UUID.randomUUID() + "-source.bin");
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
        if (!dir.equals(source.getParentFile()) || !source.getName().endsWith("-source.bin")) {
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
            if (!dir.equals(source.getParentFile()) || !source.getName().endsWith("-source.bin")) {
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
            activeTransformer.start(MediaItem.fromUri(Uri.fromFile(activeInput)), activeOutput.getAbsolutePath());
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

    @PluginMethod
    public void cancel(PluginCall call) {
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
            if (!dir.equals(file.getParentFile()) || !file.getName().endsWith("-output.mp4")) {
                call.reject("Invalid output path");
                return;
            }
            if (file.exists() && !file.delete()) {
                call.reject("Could not remove output file");
                return;
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not remove output file", error);
        }
    }
}
