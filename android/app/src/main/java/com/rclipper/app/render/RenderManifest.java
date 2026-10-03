package com.rclipper.app.render;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The server's render manifest, parsed into something the renderer can walk.
 *
 * This is the Java half of `src/lib/mobile/deviceRenderContract.ts`. It is
 * deliberately strict: a field the manifest is required to carry is read with
 * `getX` (which throws) rather than `optX` (which invents a default). A phone
 * that renders a manifest it half-understood produces a video that looks nearly
 * right, and "nearly right" is the failure mode nobody catches until a customer
 * does.
 *
 * Validation that has already happened server-side is NOT repeated here, with
 * one exception: anything that would make this code index out of bounds or
 * divide by zero is checked, because a malformed manifest must fail with a
 * message rather than a stack trace.
 */
public final class RenderManifest {

    public static final int SUPPORTED_VERSION = 4;

    public final int version;
    public final String attemptId;
    public final String jobId;
    public final String requestId;
    public final String step;
    /** "montage" | "master" | "final". */
    public final String stage;
    public final String ratio;
    public final int width;
    public final int height;
    public final int fps;
    public final double sceneTransitionSeconds;
    public final List<Source> sources;
    public final List<Scene> scenes;
    /** The montage for a master render, or the master for a final render. */
    public final String inputVideoUrl;
    public final String voiceUrl;
    public final String musicUrl;
    public final AudioSpec audio;
    public final List<Caption> captions;
    public final List<String> captionLanguages;
    public final Template template;
    public final boolean coverRequired;
    public final double coverAtSeconds;
    public final long maxOutputBytes;
    /**
     * Render this master or final straight from the approved originals — the
     * montage, the mix and (for a final) the template and captions in ONE
     * encode — instead of downloading the previous stage's export and encoding
     * it again. Sent only to builds that declare they can (plugin version 6+);
     * absent on older manifests, which keep the download path.
     */
    public final boolean buildFromSources;

    public static final class Source {
        public final String assetId;
        /** "image" | "clip". */
        public final String kind;
        /** Exactly one of url/localId is set. */
        public final String url;
        public final String localId;
        public final String mimeType;
        public final Double durationSeconds;

        Source(JSONObject json) throws JSONException {
            assetId = json.getString("assetId");
            kind = json.getString("kind");
            url = json.optString("url", null);
            localId = json.optString("localId", null);
            mimeType = json.getString("mimeType");
            durationSeconds = json.isNull("durationSeconds") ? null : json.getDouble("durationSeconds");
        }

        public boolean isImage() {
            return "image".equals(kind);
        }
    }

    public static final class Shot {
        public final String sourceAssetId;
        /** The slot this shot occupies before any dissolve overlap. */
        public final double durationSeconds;
        public final String motion;
        public final double trimStartSeconds;
        /** Null when the clip plays to its natural end. */
        public final Double trimEndSeconds;
        public final float focusX;
        public final float focusY;
        /** 0 = whole picture, 1 = fill the frame (the default). See ShotFraming. */
        public final float frameZoom;
        public final float playbackRate;

        Shot(JSONObject json) throws JSONException {
            sourceAssetId = json.getString("sourceAssetId");
            durationSeconds = json.getDouble("durationSeconds");
            motion = json.optString("motion", "static");
            trimStartSeconds = json.optDouble("trimStartSeconds", 0d);
            trimEndSeconds = json.has("trimEndSeconds") && !json.isNull("trimEndSeconds")
                ? json.getDouble("trimEndSeconds") : null;
            focusX = (float) json.optDouble("focusX", 0.5d);
            focusY = (float) json.optDouble("focusY", 0.5d);
            frameZoom = (float) Math.max(0d, Math.min(1d, json.optDouble("frameZoom", 1d)));
            playbackRate = (float) json.optDouble("playbackRate", 1d);
            if (durationSeconds <= 0) throw new JSONException("A shot has no duration");
        }
    }

    public static final class Scene {
        public final int sceneNumber;
        /** "cut" | "fade" | "slide" | "zoom". */
        public final String transitionIn;
        public final double shotTransitionSeconds;
        public final List<Shot> shots;

        Scene(JSONObject json) throws JSONException {
            sceneNumber = json.optInt("sceneNumber", 0);
            transitionIn = json.optString("transitionIn", "fade");
            shotTransitionSeconds = json.optDouble("shotTransitionSeconds", 0.2d);
            JSONArray array = json.getJSONArray("assets");
            if (array.length() == 0) throw new JSONException("A scene has no shots");
            shots = new ArrayList<>(array.length());
            for (int i = 0; i < array.length(); i++) shots.add(new Shot(array.getJSONObject(i)));
        }
    }

    /** Every number the mixer needs; see `deviceRenderAudio.ts` for the why. */
    public static final class AudioSpec {
        public final boolean musicSelected;
        public final int sampleRate;
        public final double leadInSeconds;
        public final float musicBedVolume;
        public final float duckRatio;
        public final float duckThreshold;
        public final float duckAttackMs;
        public final float duckReleaseMs;
        public final float targetLufs;
        public final float truePeakDb;
        public final float maxGainDb;
        public final float limit;
        public final Double voiceDurationSeconds;

        AudioSpec(JSONObject json) throws JSONException {
            musicSelected = json.getBoolean("musicSelected");
            sampleRate = json.getInt("sampleRate");
            leadInSeconds = json.getDouble("voiceLeadInSeconds");
            musicBedVolume = (float) json.getDouble("musicBedVolume");
            duckRatio = (float) json.getDouble("musicDuckRatio");
            duckThreshold = (float) json.getDouble("musicDuckThreshold");
            duckAttackMs = (float) json.getDouble("musicDuckAttackMs");
            duckReleaseMs = (float) json.getDouble("musicDuckReleaseMs");
            targetLufs = (float) json.getDouble("voiceTargetLufs");
            truePeakDb = (float) json.getDouble("voiceTruePeakDb");
            maxGainDb = (float) json.getDouble("voiceMaxGainDb");
            limit = (float) json.getDouble("mixLimit");
            voiceDurationSeconds = json.isNull("voiceDurationSeconds")
                ? null : json.getDouble("voiceDurationSeconds");
        }
    }

    public static final class Caption {
        public final double startSeconds;
        public final double endSeconds;
        public final String textThai;
        public final String textEnglish;
        public final String textChinese;

        Caption(JSONObject json) throws JSONException {
            startSeconds = json.getDouble("startSeconds");
            endSeconds = json.getDouble("endSeconds");
            textThai = json.optString("textThai", "");
            textEnglish = json.optString("textEnglish", "");
            textChinese = json.optString("textChinese", "");
        }

        public String textFor(String language) {
            switch (language) {
                case "th": return textThai;
                case "en": return textEnglish;
                case "zh": return textChinese;
                default: return "";
            }
        }
    }

    public static final class Template {
        public final String id;
        public final String frame;
        public final String canvas;
        public final List<String> decor;
        public final int primary;
        public final int secondary;
        public final int accent;
        public final int neutral;

        Template(JSONObject json) throws JSONException {
            id = json.getString("id");
            frame = json.getString("frame");
            canvas = json.getString("canvas");
            JSONArray decorArray = json.optJSONArray("decor");
            decor = new ArrayList<>();
            if (decorArray != null) {
                for (int i = 0; i < decorArray.length(); i++) decor.add(decorArray.getString(i));
            }
            JSONObject palette = json.getJSONObject("palette");
            primary = parseColor(palette.getString("primary"));
            secondary = parseColor(palette.getString("secondary"));
            accent = parseColor(palette.getString("accent"));
            neutral = parseColor(palette.getString("neutral"));
        }

        public boolean hasDecor(String name) {
            return decor.contains(name);
        }

        private static int parseColor(String hex) throws JSONException {
            try {
                return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
            } catch (RuntimeException error) {
                throw new JSONException("Invalid palette colour: " + hex);
            }
        }
    }

    private RenderManifest(JSONObject json) throws JSONException {
        version = json.getInt("version");
        if (version != SUPPORTED_VERSION) {
            throw new JSONException(
                "This app build renders manifest v" + SUPPORTED_VERSION + ", not v" + version);
        }
        attemptId = json.getString("attemptId");
        jobId = json.getString("jobId");
        requestId = json.getString("requestId");
        step = json.getString("step");
        stage = json.getString("stage");
        ratio = json.getString("ratio");
        width = json.getInt("width");
        height = json.getInt("height");
        fps = json.getInt("fps");
        sceneTransitionSeconds = json.optDouble("sceneTransitionSeconds", 0.2d);
        if (width <= 0 || height <= 0 || fps <= 0) throw new JSONException("Invalid canvas");

        sources = new ArrayList<>();
        JSONArray sourceArray = json.getJSONArray("sources");
        for (int i = 0; i < sourceArray.length(); i++) {
            sources.add(new Source(sourceArray.getJSONObject(i)));
        }

        scenes = new ArrayList<>();
        JSONArray sceneArray = json.getJSONArray("scenes");
        for (int i = 0; i < sceneArray.length(); i++) {
            scenes.add(new Scene(sceneArray.getJSONObject(i)));
        }

        inputVideoUrl = json.isNull("masterUrl") ? null : json.getString("masterUrl");
        voiceUrl = json.isNull("voiceUrl") ? null : json.getString("voiceUrl");
        musicUrl = json.isNull("musicUrl") ? null : json.getString("musicUrl");
        audio = new AudioSpec(json.getJSONObject("audio"));

        captions = new ArrayList<>();
        JSONArray captionArray = json.getJSONArray("captions");
        for (int i = 0; i < captionArray.length(); i++) {
            captions.add(new Caption(captionArray.getJSONObject(i)));
        }

        captionLanguages = new ArrayList<>();
        JSONArray languageArray = json.getJSONArray("captionLanguages");
        for (int i = 0; i < languageArray.length(); i++) {
            captionLanguages.add(languageArray.getString(i));
        }

        template = new Template(json.getJSONObject("template"));

        JSONObject output = json.getJSONObject("output");
        coverRequired = output.optBoolean("coverRequired", false);
        coverAtSeconds = output.optDouble("coverAtSeconds", 1d);
        maxOutputBytes = output.getLong("maxBytes");
        buildFromSources = json.optBoolean("buildFromSources", false);

        if (isMontage() && scenes.isEmpty()) {
            throw new JSONException("A montage manifest has no scenes");
        }
        if (!isMontage() && inputVideoUrl == null && scenes.isEmpty()) {
            throw new JSONException("Nothing to render from");
        }
        if (buildFromSources && (scenes.isEmpty() || sources.isEmpty())) {
            throw new JSONException("A render from sources needs its scenes and sources");
        }
        if (buildFromSources && !isMontage() && voiceUrl == null) {
            throw new JSONException("A render from sources needs the approved voice");
        }
    }

    public static RenderManifest parse(String json) throws JSONException {
        return new RenderManifest(new JSONObject(json));
    }

    public boolean isMontage() {
        return "montage".equals(stage);
    }

    public boolean isMaster() {
        return "master".equals(stage);
    }

    public boolean isFinal() {
        return "final".equals(stage);
    }

    /** Look a shot's source up; never null for a manifest that validated. */
    public Source sourceFor(Shot shot) throws JSONException {
        for (Source source : sources) {
            if (source.assetId.equals(shot.sourceAssetId)) return source;
        }
        throw new JSONException("A shot refers to a source the manifest does not carry");
    }

    /** Every shot in render order, flattened across scenes. */
    public List<Shot> flattenShots() {
        List<Shot> all = new ArrayList<>();
        for (Scene scene : scenes) all.addAll(scene.shots);
        return all;
    }

    /**
     * The dissolve length going INTO the shot at flat index `i`.
     *
     * Within a scene this is the scene's own `shotTransitionSeconds` (0 for a
     * "cut"); across a scene boundary it is the manifest's
     * `sceneTransitionSeconds`, which mirrors the server's `xfade` — unless the
     * scene's chosen transition INTO it is a cut, which the studio offers and
     * which is honoured here rather than dissolved over. The first shot of the
     * whole timeline has no dissolve.
     */
    public double dissolveBeforeFlatIndex(int flatIndex) {
        if (flatIndex <= 0) return 0d;
        int cursor = 0;
        for (Scene scene : scenes) {
            for (int i = 0; i < scene.shots.size(); i++) {
                if (cursor == flatIndex) {
                    if (i == 0) {
                        return "cut".equals(scene.transitionIn) ? 0d : sceneTransitionSeconds;
                    }
                    return "cut".equals(scene.transitionIn) ? 0d : scene.shotTransitionSeconds;
                }
                cursor++;
            }
        }
        return 0d;
    }

    /** Total picture length: every slot, end to end (dissolves borrow, never add). */
    public double pictureSeconds() {
        double total = 0d;
        for (Scene scene : scenes) {
            for (Shot shot : scene.shots) total += shot.durationSeconds;
        }
        return total;
    }

    /** The scene a flat shot index belongs to, for its transition flourish. */
    public Scene sceneForFlatIndex(int flatIndex) {
        int cursor = 0;
        for (Scene scene : scenes) {
            if (flatIndex < cursor + scene.shots.size()) return scene;
            cursor += scene.shots.size();
        }
        return scenes.isEmpty() ? null : scenes.get(scenes.size() - 1);
    }
}
