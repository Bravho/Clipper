package com.rclipper.app.render;

import android.content.Context;
import android.graphics.Matrix;
import android.net.Uri;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.MatrixTransformation;
import androidx.media3.effect.OverlayEffect;
import androidx.media3.effect.Presentation;
import androidx.media3.effect.SpeedChangeEffect;
import androidx.media3.common.Effect;
import androidx.media3.common.VideoCompositorSettings;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;

import com.google.common.collect.ImmutableList;

import org.json.JSONException;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Turns a validated render manifest into a Media3 {@link Composition}.
 *
 * One class per stage would have duplicated the canvas, the overlay wiring and
 * the fallback logic three times; instead each stage is a method and the shared
 * decisions live in one place.
 *
 *   montage → the approved photos and clips, with Ken Burns, focus crop, trims,
 *             playback-rate fill and dissolves, exported SILENT.
 *   master  → that montage plus the mixed voice and ducked music (the mix
 *             itself is {@link AudioMixer}'s job — Media3 cannot do it).
 *   final   → that master with the template and captions burned in, its audio
 *             carried through untouched.
 *
 * FROM SOURCES (plugin version 6+). When the manifest says `buildFromSources`,
 * the master and the final are NOT built on the previous stage's download. Each
 * is composed straight from the approved originals — the montage's shots, the
 * mixed voice and music, and for the final the template and captions as
 * composition-level effects — and encoded ONCE. The server's pipeline encodes
 * the delivered video three times (montage, master, styled render); this path
 * encodes it once from the camera originals, and downloads nothing but the
 * voice and the music track.
 *
 * WHERE THIS DIFFERS FROM THE SERVER, HONESTLY. The cross-dissolve is the hard
 * part: Media3 has no transition primitive, so shots are ping-ponged between
 * two video sequences and the overlay's alpha is ramped across each join by a
 * {@link CrossDissolveCompositorSettings}. That path is the one piece of this
 * renderer with no direct FFmpeg equivalent, so {@link #buildMontage} takes a
 * flag and the caller retries with hard cuts if the dissolving composition
 * fails to export — a video with visible cuts beats no video, and the result
 * says which path produced it so a comparison against the Mac output is never
 * guesswork.
 */
@OptIn(markerClass = UnstableApi.class)
public final class ManifestRenderer {

    private final Context context;

    /**
     * The last-resort build: every shot plainly cover-cropped to the canvas,
     * as renders were before per-shot framing existed. {@link ManifestJob}
     * switches it on only after the normal builds have failed on this phone, so
     * a framing this phone's GPU pipeline refuses costs the framing, never the
     * video.
     */
    public boolean plainFraming = false;

    public ManifestRenderer(Context context) {
        this.context = context;
    }

    /** Where each source's bytes ended up after staging or download. */
    public interface SourceResolver {
        File fileFor(String assetId) throws JSONException;
    }

    /** A built composition plus what the caller needs to report about it. */
    public static final class Built {
        public final Composition composition;
        public final boolean crossDissolved;
        public final double durationSeconds;
        /** Overlays to release once the export finishes. */
        public final List<Runnable> cleanup;
        /** A final export that draws the motion template (so dropping it is a real fallback). */
        public final boolean templateIncluded;

        Built(Composition composition, boolean crossDissolved, double durationSeconds,
              List<Runnable> cleanup) {
            this(composition, crossDissolved, durationSeconds, cleanup, false);
        }

        Built(Composition composition, boolean crossDissolved, double durationSeconds,
              List<Runnable> cleanup, boolean templateIncluded) {
            this.composition = composition;
            this.crossDissolved = crossDissolved;
            this.durationSeconds = durationSeconds;
            this.cleanup = cleanup;
            this.templateIncluded = templateIncluded;
        }
    }

    // ── montage ─────────────────────────────────────────────────────────────

    /**
     * The silent intermediate: every approved shot in order, cover-cropped to
     * the canvas, stills animated, clips trimmed and muted.
     *
     * @param crossDissolve false builds hard cuts in a single sequence, which is
     *                      the fallback when the dissolving composition fails.
     */
    public Built buildMontage(
        RenderManifest manifest, SourceResolver resolver, boolean crossDissolve
    ) throws JSONException {
        Picture picture = buildPicture(manifest, resolver, crossDissolve, 0d);
        Composition.Builder builder = new Composition.Builder(picture.sequences);
        if (picture.compositor != null) builder.setVideoCompositorSettings(picture.compositor);
        return new Built(builder.build(), picture.crossDissolved, picture.seconds,
            Collections.emptyList());
    }

    /** The edit's picture: its video sequences and how they are composited. */
    private static final class Picture {
        final List<EditedMediaItemSequence> sequences;
        /** Null for the default compositor (a single sequence of hard cuts). */
        final VideoCompositorSettings compositor;
        final boolean crossDissolved;
        final double seconds;

        Picture(List<EditedMediaItemSequence> sequences, VideoCompositorSettings compositor,
                boolean crossDissolved, double seconds) {
            this.sequences = sequences;
            this.compositor = compositor;
            this.crossDissolved = crossDissolved;
            this.seconds = seconds;
        }
    }

    /**
     * Every approved shot in order, cover-cropped to the canvas, stills
     * animated, clips trimmed and muted — as one sequence of hard cuts, or as
     * two ping-ponged sequences that dissolve.
     *
     * @param padToSeconds when the audio runs longer than the picture (a voice
     *                     that overran the storyboard), black frames are added
     *                     after the last shot up to this length, exactly as the
     *                     server's compose step pads with black rather than
     *                     freezing the last frame. 0 = no padding.
     */
    private Picture buildPicture(
        RenderManifest manifest, SourceResolver resolver, boolean crossDissolve, double padToSeconds
    ) throws JSONException {
        List<RenderManifest.Shot> shots = manifest.flattenShots();
        if (shots.isEmpty()) throw new JSONException("The manifest has no shots");

        // Slot starts, and the dissolve going into each shot. A dissolve borrows
        // from the previous shot's tail rather than extending the timeline, so
        // the total length is the sum of the slots — exactly as `MontageScene`
        // keeps the scene length unchanged.
        double[] starts = new double[shots.size()];
        double[] dissolves = new double[shots.size()];
        double cursor = 0;
        for (int i = 0; i < shots.size(); i++) {
            double dissolve = manifest.dissolveBeforeFlatIndex(i);
            // Never dissolve longer than half of either neighbouring shot.
            if (i > 0) {
                double maxFade = Math.min(
                    shots.get(i).durationSeconds, shots.get(i - 1).durationSeconds) / 2d;
                dissolve = Math.min(dissolve, maxFade);
            }
            dissolves[i] = Math.max(0, dissolve);
            starts[i] = cursor;
            cursor += shots.get(i).durationSeconds;
        }
        double total = cursor;
        double tail = padToSeconds - total;
        long tailUs = tail > 0.05d ? Math.round(tail * 1_000_000d) : 0L;

        // Two lanes are only worth building when something actually fades.
        // A single shot leaves lane 1 with nothing in it, and a timeline of
        // pure cuts leaves it holding nothing but gaps; Media3 rejects an empty
        // sequence and a gap-only one alike. In both cases the single-sequence
        // build is the CORRECT composition, not a fallback from a failure, so
        // it is chosen here rather than discovered by an exception.
        boolean anyDissolve = false;
        for (double dissolve : dissolves) {
            if (dissolve > 0) {
                anyDissolve = true;
                break;
            }
        }

        if (!crossDissolve || shots.size() < 2 || !anyDissolve) {
            List<EditedMediaItem> items = new ArrayList<>();
            for (int i = 0; i < shots.size(); i++) {
                items.add(buildShot(manifest, resolver, shots.get(i), i, 0, 0));
            }
            EditedMediaItemSequence sequence = EditedMediaItemSequence.withVideoFrom(items);
            if (tailUs > 0) sequence = sequence.buildUpon().addGap(tailUs).build();
            List<EditedMediaItemSequence> sequences = new ArrayList<>();
            sequences.add(sequence);
            return new Picture(sequences, null, false, Math.max(total, padToSeconds));
        }

        // Ping-pong: shot i goes on sequence (i % 2), with a gap on the other
        // sequence for the time it is on screen. Sequence 1 overlays sequence 0,
        // so the compositor's alpha on input 1 is the whole dissolve.
        // FORCING THE VIDEO TRACK IS NOT OPTIONAL HERE. Lane 1's first entry is
        // shot 1, which only appears once shot 0 has been on screen for a
        // while, so that sequence ALWAYS opens with a gap. Since Media3 1.8 a
        // sequence whose first item is a Gap cannot infer what to fill it with,
        // and `build()` throws "If the first item in the sequence is a Gap,
        // then forceAudioTrack or forceVideoTrack flag must be set" before a
        // single frame is encoded. The picture is video only, so the gap is
        // filled with blank frames — invisible in the result, because
        // CrossDissolveCompositorSettings holds lane 1 at alpha 0 for exactly
        // the span the gap covers.
        EditedMediaItemSequence.Builder[] sequences = new EditedMediaItemSequence.Builder[] {
            new EditedMediaItemSequence.Builder().experimentalSetForceVideoTrack(true),
            new EditedMediaItemSequence.Builder().experimentalSetForceVideoTrack(true),
        };
        double[] filledTo = new double[] { 0d, 0d };

        for (int i = 0; i < shots.size(); i++) {
            int lane = i % 2;
            // The incoming shot mounts `dissolve` early so it overlaps the
            // outgoing shot's tail, and keeps its own end, so the timeline is
            // unchanged.
            double itemStart = Math.max(0, starts[i] - dissolves[i]);
            double itemDuration = starts[i] + shots.get(i).durationSeconds - itemStart;

            double gap = itemStart - filledTo[lane];
            if (gap > 0.0005) {
                sequences[lane].addGap(Math.round(gap * 1_000_000d));
            }
            sequences[lane].addItem(buildShot(
                manifest, resolver, shots.get(i), i,
                dissolves[i], itemDuration
            ));
            filledTo[lane] = itemStart + itemDuration;
        }

        // A black tail after the last shot, on both lanes, so whichever lane the
        // compositor is holding shows black rather than a stale frame.
        double end = Math.max(total, padToSeconds);
        if (tailUs > 0) {
            for (int lane = 0; lane < 2; lane++) {
                double gap = end - filledTo[lane];
                if (gap > 0.0005) sequences[lane].addGap(Math.round(gap * 1_000_000d));
            }
        }

        List<EditedMediaItemSequence> built = new ArrayList<>();
        built.add(sequences[0].build());
        built.add(sequences[1].build());
        return new Picture(built,
            new CrossDissolveCompositorSettings(shots, starts, dissolves, manifest),
            true, end);
    }

    /**
     * One shot as an {@link EditedMediaItem}: cover-cropped to the canvas, then
     * animated (a still) or trimmed and rate-adjusted (a clip), always muted.
     *
     * `itemDurationSeconds` is the shot's on-screen length INCLUDING the
     * dissolve overlap it mounts early with; 0 means "use the slot".
     */
    private EditedMediaItem buildShot(
        RenderManifest manifest,
        SourceResolver resolver,
        RenderManifest.Shot shot,
        int flatIndex,
        double dissolveSeconds,
        double itemDurationSeconds
    ) throws JSONException {
        RenderManifest.Source source = manifest.sourceFor(shot);
        File file = resolver.fileFor(source.assetId);
        if (file == null || !file.isFile()) {
            throw new JSONException("Source " + source.assetId + " was not staged");
        }

        double duration = itemDurationSeconds > 0 ? itemDurationSeconds : shot.durationSeconds;
        RenderManifest.Scene scene = manifest.sceneForFlatIndex(flatIndex);
        String transition = scene == null ? "fade" : scene.transitionIn;

        List<Effect> effects = new ArrayList<>();
        // Frame to the canvas FIRST, so the motion that follows operates on the
        // framing the requester approved rather than on the raw photo. A shot
        // left at "fill the frame" and centred keeps the plain cover crop it
        // always had; any other framing (show more of the picture, or keep an
        // off-centre subject in view) fits the whole picture and then places it
        // — see ShotFraming and src/lib/mobile/shotFraming.ts.
        Matrix framing = null;
        if (!plainFraming && ShotFraming.needsPlacement(shot.frameZoom, shot.focusX, shot.focusY)) {
            int[] size = ShotFraming.pictureSize(file, source.isImage());
            if (size != null) {
                framing = ShotFraming.placement(size[0], size[1], manifest.width, manifest.height,
                    shot.frameZoom, shot.focusX, shot.focusY);
            }
        }
        if (framing != null) {
            final Matrix placed = framing;
            effects.add(Presentation.createForWidthAndHeight(
                manifest.width, manifest.height, Presentation.LAYOUT_SCALE_TO_FIT));
            effects.add((MatrixTransformation) presentationTimeUs -> placed);
        } else {
            effects.add(Presentation.createForWidthAndHeight(
                manifest.width, manifest.height, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP));
        }

        if (source.isImage()) {
            effects.add(kenBurnsEffect(shot, duration, transition, dissolveSeconds));

            MediaItem item = new MediaItem.Builder()
                .setUri(Uri.fromFile(file))
                .setImageDurationMs(Math.round(duration * 1000d))
                .build();
            return new EditedMediaItem.Builder(item)
                .setFrameRate(manifest.fps)
                .setEffects(new Effects(Collections.emptyList(), effects))
                .build();
        }

        // A clip plays as shot; only the entrance flourish moves it.
        if (!"fade".equals(transition) && !"cut".equals(transition) && dissolveSeconds > 0) {
            effects.add(entranceEffect(transition, dissolveSeconds));
        }
        if (shot.playbackRate > 0 && Math.abs(shot.playbackRate - 1f) > 0.001f) {
            // Slow the clip to fill a slot longer than its footage, rather than
            // freezing the last frame. Audio is removed anyway, so the video-only
            // speed effect is enough.
            effects.add(new SpeedChangeEffect(shot.playbackRate));
        }

        long startMs = Math.round(shot.trimStartSeconds * 1000d);
        MediaItem.ClippingConfiguration.Builder clipping =
            new MediaItem.ClippingConfiguration.Builder().setStartPositionMs(startMs);
        if (shot.trimEndSeconds != null) {
            clipping.setEndPositionMs(Math.round(shot.trimEndSeconds * 1000d));
        }

        MediaItem item = new MediaItem.Builder()
            .setUri(Uri.fromFile(file))
            .setClippingConfiguration(clipping.build())
            .build();

        return new EditedMediaItem.Builder(item)
            // The montage discards material clip audio. This is not an
            // optimisation — the approved voice is the only narration, and a
            // stray camera track underneath it is the bug the parity doc calls
            // out first.
            .setRemoveAudio(true)
            .setEffects(new Effects(Collections.emptyList(), effects))
            .build();
    }

    /**
     * Seconds since this item's FIRST frame.
     *
     * THE BUG THIS REMOVES. Inside a sequence, Media3 hands an item's effects
     * presentation times that already include the length of every item before
     * it in the sequence — the shot at 0:09 sees its first frame at 9 000 000
     * µs, not 0. The Ken Burns effect divided that by the shot's own length, so
     * every photo after the first began at progress > 1, was clamped to the
     * end of its move, and sat perfectly still: a still image where a camera
     * move was approved. Measuring from the first frame the effect actually
     * sees is right whatever offset Media3 applies (and still right when there
     * is none, as for the first shot).
     */
    private static final class ItemClock {
        private long firstUs = Long.MIN_VALUE;

        double secondsAt(long presentationTimeUs) {
            if (firstUs == Long.MIN_VALUE || presentationTimeUs < firstUs) {
                firstUs = presentationTimeUs;
            }
            return (presentationTimeUs - firstUs) / 1_000_000d;
        }
    }

    /** Ken Burns, plus the named transition's entrance flourish while it fades. */
    private MatrixTransformation kenBurnsEffect(
        RenderManifest.Shot shot, double durationSeconds, String transition, double dissolveSeconds
    ) {
        final double duration = Math.max(durationSeconds, 1d / 1000d);
        final ItemClock clock = new ItemClock();
        return presentationTimeUs -> {
            double t = clock.secondsAt(presentationTimeUs);
            float progress = (float) (t / duration);
            Matrix matrix = MotionMath.kenBurns(shot.motion, progress, shot.focusX, shot.focusY);

            if (dissolveSeconds > 0 && t < dissolveSeconds
                && !"fade".equals(transition) && !"cut".equals(transition)) {
                float fade = (float) (t / dissolveSeconds);
                matrix.postConcat(MotionMath.entrance(transition, fade));
            }
            return matrix;
        };
    }

    private MatrixTransformation entranceEffect(String transition, double dissolveSeconds) {
        final ItemClock clock = new ItemClock();
        return presentationTimeUs -> {
            double t = clock.secondsAt(presentationTimeUs);
            float fade = dissolveSeconds > 0
                ? MotionMath.clamp((float) (t / dissolveSeconds), 0f, 1f) : 1f;
            return MotionMath.entrance(transition, fade);
        };
    }

    // ── master ──────────────────────────────────────────────────────────────

    /**
     * The montage plus the pre-mixed audio track.
     *
     * The mix is a single AAC file produced by {@link AudioMixer} before this is
     * called, so all that is left is to put the picture and that track on the
     * same timeline. Doing it this way — rather than handing Media3 the voice
     * and music as separate sequences with a gain processor — is what makes the
     * lead-in, the loudness normalisation and the ducking match the server at
     * all.
     */
    public Built buildMaster(RenderManifest manifest, File montage, File mixedAudio) {
        EditedMediaItem video = new EditedMediaItem.Builder(
            MediaItem.fromUri(Uri.fromFile(montage))
        ).setRemoveAudio(true).build();

        EditedMediaItem audio = new EditedMediaItem.Builder(
            MediaItem.fromUri(Uri.fromFile(mixedAudio))
        ).setRemoveVideo(true).build();

        List<EditedMediaItemSequence> sequences = new ArrayList<>();
        sequences.add(EditedMediaItemSequence.withVideoFrom(Collections.singletonList(video)));
        sequences.add(EditedMediaItemSequence.withAudioFrom(Collections.singletonList(audio)));

        return new Built(new Composition.Builder(sequences).build(), false, 0d,
            Collections.emptyList());
    }

    // ── final ───────────────────────────────────────────────────────────────

    /**
     * The delivered export: the approved master with the template and timed
     * captions drawn on top, its audio carried straight through.
     *
     * The master already carries the mixed voice and ducked music, so nothing
     * here touches the audio — the same decision `overlayOnMaster` makes with
     * `-c:a copy`. Re-encoding it would risk a second normalisation pass on a
     * track that has already been normalised once.
     */
    public Built buildFinal(RenderManifest manifest, File master) {
        return buildFinal(manifest, master, true);
    }

    /**
     * @param includeTemplate false drops the motion template and keeps the
     *                        captions — the fallback when the two-overlay
     *                        export fails on a device. Captions carry the
     *                        words; the template is decoration, so it is the
     *                        one to lose.
     */
    public Built buildFinal(RenderManifest manifest, File master, boolean includeTemplate) {
        List<Runnable> cleanup = new ArrayList<>();
        Decoration decoration = decoration(manifest, includeTemplate, cleanup);

        EditedMediaItem item = new EditedMediaItem.Builder(
            MediaItem.fromUri(Uri.fromFile(master))
        ).setEffects(new Effects(Collections.emptyList(), decoration.effects)).build();

        Composition composition = new Composition.Builder(
            new EditedMediaItemSequence.Builder(item).build()
        ).build();

        return new Built(composition, false, 0d, cleanup, decoration.templateIncluded);
    }

    // ── master and final, straight from the originals ────────────────────────

    /**
     * The merged master in one encode: the edit's picture plus the pre-mixed
     * audio track, both built here rather than downloaded.
     */
    public Built buildMasterFromSources(
        RenderManifest manifest, SourceResolver resolver, File mixedAudio,
        double totalSeconds, boolean crossDissolve
    ) throws JSONException {
        Picture picture = buildPicture(manifest, resolver, crossDissolve, totalSeconds);
        return new Built(withAudio(picture, mixedAudio, null), picture.crossDissolved,
            picture.seconds, Collections.emptyList());
    }

    /**
     * The delivered video in one encode: picture, mixed audio, and — as
     * composition-level effects, so they run on the composited frame in
     * timeline time — the template (with its inset for framed_cream) and the
     * captions on top.
     *
     * @param includeTemplate false drops the template and keeps the captions —
     *                        the last fallback on a device whose GPU will not
     *                        run both overlays.
     */
    public Built buildFinalFromSources(
        RenderManifest manifest, SourceResolver resolver, File mixedAudio,
        double totalSeconds, boolean crossDissolve, boolean includeTemplate
    ) throws JSONException {
        Picture picture = buildPicture(manifest, resolver, crossDissolve, totalSeconds);
        List<Runnable> cleanup = new ArrayList<>();
        Decoration decoration = decoration(manifest, includeTemplate, cleanup);
        Composition composition = withAudio(picture, mixedAudio, decoration.effects);
        return new Built(composition, picture.crossDissolved, picture.seconds, cleanup,
            decoration.templateIncluded);
    }

    /** The picture's sequences plus one audio sequence, and optional frame effects. */
    private Composition withAudio(Picture picture, File mixedAudio, List<Effect> videoEffects) {
        EditedMediaItem audio = new EditedMediaItem.Builder(
            MediaItem.fromUri(Uri.fromFile(mixedAudio))
        ).setRemoveVideo(true).build();

        List<EditedMediaItemSequence> sequences = new ArrayList<>(picture.sequences);
        // The audio sequence goes LAST, so the video inputs keep the indexes
        // CrossDissolveCompositorSettings expects (0 = base lane, 1 = overlay).
        sequences.add(EditedMediaItemSequence.withAudioFrom(Collections.singletonList(audio)));

        Composition.Builder builder = new Composition.Builder(sequences);
        if (picture.compositor != null) builder.setVideoCompositorSettings(picture.compositor);
        if (videoEffects != null && !videoEffects.isEmpty()) {
            builder.setEffects(new Effects(Collections.emptyList(), videoEffects));
        }
        return builder.build();
    }

    /** The template and caption effects for a finished export. */
    private static final class Decoration {
        final List<Effect> effects = new ArrayList<>();
        boolean templateIncluded;
    }

    /**
     * Template (inset first, then its layer) and captions on top, matching the
     * composition's layer order: video, template frame/decor, subtitles.
     */
    private Decoration decoration(
        RenderManifest manifest, boolean includeTemplate, List<Runnable> cleanup
    ) {
        Decoration decoration = new Decoration();
        List<androidx.media3.effect.TextureOverlay> overlays = new ArrayList<>();

        TemplatePainter templatePainter =
            new TemplatePainter(manifest.template, manifest.width, manifest.height);
        if (includeTemplate && !templatePainter.isEmpty()) {
            decoration.templateIncluded = true;
            if (templatePainter.isInset()) {
                // Scale the picture into the card's window BEFORE the overlay
                // draws the card and canvas around it.
                final Matrix inset = templatePainter.insetTransform();
                decoration.effects.add((MatrixTransformation) presentationTimeUs -> inset);
            }
            Overlays.TemplateOverlay overlay =
                new Overlays.TemplateOverlay(templatePainter, manifest.width, manifest.height);
            overlays.add(overlay);
            cleanup.add(overlay::release);
        } else {
            templatePainter.release();
        }

        CaptionPainter captionPainter = new CaptionPainter(
            manifest.width, manifest.height, manifest.captionLanguages, manifest.captions);
        if (captionPainter.hasCaptions()) {
            Overlays.CaptionOverlay overlay =
                new Overlays.CaptionOverlay(captionPainter, manifest.width, manifest.height);
            overlays.add(overlay);
            cleanup.add(overlay::release);
        } else {
            captionPainter.release();
        }

        if (!overlays.isEmpty()) {
            decoration.effects.add(new OverlayEffect(ImmutableList.copyOf(overlays)));
        }
        return decoration;
    }

    /** The video MIME type every stage encodes to. */
    public static String videoMimeType() {
        return MimeTypes.VIDEO_H264;
    }

    /** The audio MIME type the master and final stages encode to. */
    public static String audioMimeType() {
        return MimeTypes.AUDIO_AAC;
    }

    /** Media3's own name for "this sequence carries no audio". */
    public static int audioTrackType() {
        return C.TRACK_TYPE_AUDIO;
    }
}
