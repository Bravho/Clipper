import io

p = "android/app/src/main/java/com/rclipper/app/DeviceVideoRenderPlugin.java"
s = io.open(p, encoding="utf-8").read()

# ── 1. imports ──────────────────────────────────────────────────────────────
old_imports = """import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;"""
assert s.count(old_imports) == 1, "imports anchor"
new_imports = """import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import java.util.HashMap;
import java.util.Map;

import com.rclipper.app.render.ManifestJob;
import com.rclipper.app.render.RenderManifest;
import com.rclipper.app.render.Transfers;"""
s = s.replace(old_imports, new_imports, 1)

# ── 2. version bump ─────────────────────────────────────────────────────────
old_version = '        result.put("nativePluginVersion", 4);'
assert s.count(old_version) == 1, "version anchor"
new_version = '''        // v5 adds renderManifest/uploadOutput: the complete phone editor path.
        // The web layer checks this before offering to render a real job, so an
        // installed v4 build keeps working as a local draft tester and is never
        // handed production work it cannot finish.
        result.put("nativePluginVersion", 5);'''
s = s.replace(old_version, new_version, 1)

# ── 3. new methods, inserted before the cancel() method ─────────────────────
anchor = """    @PluginMethod
    public void cancel(PluginCall call) {"""
assert s.count(anchor) == 1, "cancel anchor"

addition = '''    // ── v5: the complete manifest render path ───────────────────────────────

    /** The manifest render in flight, so cancel() can reach it. */
    private ManifestJob activeManifestJob;
    /** Outputs a manifest render produced, kept until the web layer releases them. */
    private final Map<String, File> manifestOutputs = new HashMap<>();

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
                    staged.put(entry.getString("key"), validStagedFile(entry.getString("sourceUrl")));
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

'''

s = s.replace(anchor, addition + anchor, 1)

# ── 4. cancel() must also stop a manifest job ───────────────────────────────
old_cancel = """    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            PluginCall renderCall = activeCall;
            activeCall = null;"""
assert s.count(old_cancel) == 1, "cancel body anchor"
new_cancel = """    @PluginMethod
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
            activeCall = null;"""
s = s.replace(old_cancel, new_cancel, 1)

# ── 5. releaseOutput should also forget a manifest output ───────────────────
old_release = """            if (file.exists() && !file.delete()) {
                call.reject("Could not remove output file");
                return;
            }
            call.resolve();"""
assert s.count(old_release) == 1, "release anchor"
new_release = """            if (file.exists() && !file.delete()) {
                call.reject("Could not remove output file");
                return;
            }
            manifestOutputs.remove(file.getAbsolutePath());
            call.resolve();"""
s = s.replace(old_release, new_release, 1)

# ── 6. releaseOutput must accept a cover JPEG too ──────────────────────────
old_guard = """            if (!dir.equals(file.getParentFile()) || !file.getName().endsWith("-output.mp4")) {
                call.reject("Invalid output path");
                return;
            }"""
assert s.count(old_guard) == 1, "output guard anchor"
new_guard = """            boolean isRenderOutput = file.getName().endsWith("-output.mp4")
                || file.getName().endsWith("-cover.jpg");
            if (!dir.equals(file.getParentFile()) || !isRenderOutput) {
                call.reject("Invalid output path");
                return;
            }"""
s = s.replace(old_guard, new_guard, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("plugin patched")
