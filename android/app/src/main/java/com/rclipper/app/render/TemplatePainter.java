package com.rclipper.app.render;

import static com.rclipper.app.render.TemplateMotion.beatEnvelope;
import static com.rclipper.app.render.TemplateMotion.beatProgress;
import static com.rclipper.app.render.TemplateMotion.clamp01;
import static com.rclipper.app.render.TemplateMotion.easeInOutCubic;
import static com.rclipper.app.render.TemplateMotion.easeOutBack;
import static com.rclipper.app.render.TemplateMotion.easeOutCubic;
import static com.rclipper.app.render.TemplateMotion.outro;
import static com.rclipper.app.render.TemplateMotion.ramp;
import static com.rclipper.app.render.TemplateMotion.sceneCount;
import static com.rclipper.app.render.TemplateMotion.sceneFraction;
import static com.rclipper.app.render.TemplateMotion.sceneIndex;
import static com.rclipper.app.render.TemplateMotion.videoProgress;
import static com.rclipper.app.render.TemplateMotion.wave;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Region;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Build;

/**
 * Draws the motion-graphic template (Look) layer at any frame time.
 *
 * THE REFERENCE IS `src/lib/motionTemplates/templateRenderer.ts` (motion in
 * `motion.ts`, mirrored by {@link TemplateMotion}). Every position, size,
 * colour, opacity and timing below is read off it, and the drawing calls are
 * the same calls in the same order. Change all three renderers together
 * (iOS: `OverlayPainter.swift`).
 *
 *   clean_frame  — brackets grow out of the corners with an overshoot,
 *                  breathe, punch inward on cuts and close in at the end;
 *                  ripples; a segmented scene-progress bar top-centre.
 *   framed_cream — the video inset in a white card on a warm gradient; colour
 *                  blobs drift in the margins; branch draws on and sways; dots
 *                  bob; sparkles twinkle and pop on cuts; an accent comet runs
 *                  round the card on cuts and outlines it at the end.
 *   editorial    — scrims; a hairline frame that draws on; a kicker that pops;
 *                  a rolling "02 / 05" scene counter; an accent frame at the end.
 *   bold_pop     — stripes from two corners, floating confetti, a slanted
 *                  colour wipe across every cut, a progress line at the bottom.
 *   cinematic    — letterbox bars with accent hairlines, vignette, drifting
 *                  light leak, an anamorphic flare across cuts, a darker close.
 *
 * Lengths use `s = min(width, height) / 1080`.
 *
 * THE TIMELINE. The manifest's `template.beats` (cut times) and
 * `template.endSeconds` drive the cut accents, the progress and the outro.
 * From a server that does not send them, the Look still breathes and enters;
 * it just has no cut accents, progress or outro.
 *
 * COST. Every Look now moves for the whole video, so the bitmap is redrawn
 * each frame. What never changes — scrims, the warm canvas, the card with its
 * blurred shadow, the vignette — is painted once into cached bitmaps and
 * blitted, so a frame is a clear, one or two blits and a handful of paths.
 * Paints and paths are reused; nothing large is allocated per frame.
 *
 * THE INSET. framed_cream shows the video INSIDE a card. The picture is scaled
 * into the card's window by {@link #insetTransform} (a GL matrix applied before
 * the overlay); this painter leaves the window transparent (even-odd fills).
 */
public final class TemplatePainter {

    private static final float REFERENCE_SHORT_SIDE = 1080f;
    private static final float CARD_PADDING = 22f;
    private static final float CARD_RADIUS = 34f;
    private static final float WINDOW_RADIUS = 22f;

    private final RenderManifest.Template template;
    private final int width;
    private final int height;
    private final float s;
    private final double[] beats;
    private final double end;

    private Bitmap bitmap;
    private Canvas canvas;
    /** Static layer under the motion (scrims / warm canvas / vignette). */
    private Bitmap base;
    /** framed_cream's card, above the blobs. */
    private Bitmap card;
    private double drawnAt = Double.NaN;

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint blit = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Path path = new Path();
    private final Path segment = new Path();
    private final PathMeasure measure = new PathMeasure();

    public TemplatePainter(RenderManifest.Template template, int width, int height) {
        this.template = template;
        this.width = width;
        this.height = height;
        this.s = Math.min(width, height) / REFERENCE_SHORT_SIDE;
        this.beats = template.beats != null ? template.beats : new double[0];
        this.end = template.endSeconds;
        stroke.setStyle(Paint.Style.STROKE);
    }

    /** The template id this build draws, with the catalogue's frame as a fallback. */
    private String look() {
        String id = template.id == null ? "none" : template.id;
        switch (id) {
            case "clean_frame":
            case "framed_cream":
            case "editorial":
            case "bold_pop":
            case "cinematic":
            case "none":
                return id;
            default:
                if ("rounded_inset".equals(template.frame)) return "framed_cream";
                if ("corner_bracket".equals(template.frame)) return "clean_frame";
                return "none";
        }
    }

    public boolean isEmpty() {
        return "none".equals(look());
    }

    public boolean isInset() {
        return "framed_cream".equals(look());
    }

    /** The video's window inside the card, in output pixels. */
    public RectF insetWindow() {
        RectF c = cardRect();
        return new RectF(c.left + CARD_PADDING, c.top + CARD_PADDING,
            c.right - CARD_PADDING, c.bottom - CARD_PADDING);
    }

    private RectF cardRect() {
        return new RectF(width * 0.055f, height * 0.065f, width * (1f - 0.055f), height * (1f - 0.13f));
    }

    /** GL (NDC) matrix that cover-fits the full-frame video into {@link #insetWindow}. */
    public android.graphics.Matrix insetTransform() {
        RectF window = insetWindow();
        float scale = Math.max(window.width() / width, window.height() / height);
        float centerX = window.centerX() / width * 2f - 1f;
        float centerY = 1f - window.centerY() / height * 2f;
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        matrix.postScale(scale, scale);
        matrix.postTranslate(centerX, centerY);
        return matrix;
    }

    public void release() {
        for (Bitmap b : new Bitmap[] { bitmap, base, card }) {
            if (b != null && !b.isRecycled()) b.recycle();
        }
        bitmap = null;
        base = null;
        card = null;
        canvas = null;
    }

    /** The template layer at `seconds`; the same bitmap redrawn in place. */
    public Bitmap draw(double seconds) {
        if (isEmpty()) return null;
        if (bitmap != null && !Double.isNaN(drawnAt) && Math.abs(drawnAt - seconds) < 1e-6) {
            return bitmap;
        }
        if (bitmap == null) {
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            canvas = new Canvas(bitmap);
        }
        bitmap.eraseColor(Color.TRANSPARENT);
        double t = Math.max(0d, seconds);
        switch (look()) {
            case "clean_frame":
                drawCleanFrame(t);
                break;
            case "framed_cream":
                drawFramedCream(t);
                break;
            case "editorial":
                drawEditorial(t);
                break;
            case "bold_pop":
                drawBoldPop(t);
                break;
            case "cinematic":
                drawCinematic(t);
                break;
            default:
                break;
        }
        drawnAt = seconds;
        return bitmap;
    }

    // ── shared helpers ──────────────────────────────────────────────────────

    private static int withAlpha(int color, double alpha) {
        return Color.argb((int) Math.round(255 * clamp01(alpha)),
            Color.red(color), Color.green(color), Color.blue(color));
    }

    private static int mix(int a, int b, float k) {
        return Color.rgb(
            Math.round(Color.red(a) * (1 - k) + Color.red(b) * k),
            Math.round(Color.green(a) * (1 - k) + Color.green(b) * k),
            Math.round(Color.blue(a) * (1 - k) + Color.blue(b) * k));
    }

    /** Stroke the fraction [from, to] of `p` with `paint` (draws all of it when 0..1). */
    private void strokeSegment(Path p, float from, float to, Paint paint) {
        float a = (float) clamp01(from);
        float b = (float) clamp01(to);
        if (b <= a) return;
        if (a <= 0f && b >= 1f) {
            canvas.drawPath(p, paint);
            return;
        }
        measure.setPath(p, false);
        float length = measure.getLength();
        segment.reset();
        measure.getSegment(a * length, b * length, segment, true);
        canvas.drawPath(segment, paint);
    }

    /** Stroke the first `visible` px of `p` — the old dasharray draw-on. */
    private void strokeLength(Path p, float visible, Paint paint) {
        if (visible <= 0f) return;
        measure.setPath(p, false);
        float length = measure.getLength();
        if (length <= 0f) return;
        strokeSegment(p, 0f, visible / length, paint);
    }

    /** `roundRectFromTop`: clockwise from the top edge's midpoint. */
    private static void roundRectFromTop(Path p, RectF r, float radius) {
        float k = Math.min(radius, Math.min(r.width() / 2f, r.height() / 2f));
        p.reset();
        p.moveTo(r.centerX(), r.top);
        p.lineTo(r.right - k, r.top);
        p.arcTo(new RectF(r.right - 2 * k, r.top, r.right, r.top + 2 * k), -90f, 90f, false);
        p.lineTo(r.right, r.bottom - k);
        p.arcTo(new RectF(r.right - 2 * k, r.bottom - 2 * k, r.right, r.bottom), 0f, 90f, false);
        p.lineTo(r.left + k, r.bottom);
        p.arcTo(new RectF(r.left, r.bottom - 2 * k, r.left + 2 * k, r.bottom), 90f, 90f, false);
        p.lineTo(r.left, r.top + k);
        p.arcTo(new RectF(r.left, r.top, r.left + 2 * k, r.top + 2 * k), 180f, 90f, false);
        p.close();
    }

    /** The concave four-point sparkle, centred on the origin. */
    private static void star4(Path p, float r) {
        float i = r * 0.24f;
        p.reset();
        p.moveTo(0f, -r);
        p.cubicTo(i, -i, i, -i, r, 0f);
        p.cubicTo(i, i, i, i, 0f, r);
        p.cubicTo(-i, i, -i, i, -r, 0f);
        p.cubicTo(-i, -i, -i, -i, 0f, -r);
        p.close();
    }

    private Bitmap newLayer() {
        Bitmap b = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        b.eraseColor(Color.TRANSPARENT);
        return b;
    }

    // ── clean_frame ─────────────────────────────────────────────────────────

    private static final int[][] CLEAN_CORNERS = { { 1, 1 }, { -1, 1 }, { -1, -1 }, { 1, -1 } };

    private float cleanBracketOffset(int k, double t) {
        double intro = ramp(t, 0.1 + 0.08 * k, 0.65);
        double slide = (1 - easeOutBack(intro)) * 36 * s;
        double breathe = 5 * s * wave(t, 4.2) * ramp(t, 0.8, 0.6);
        double punch = 16 * s * beatEnvelope(t, beats, 0.06, 0.5);
        double close = 22 * s * easeInOutCubic(outro(t, end, 1.2));
        return (float) (slide + breathe - punch - close);
    }

    private void drawCleanFrame(double t) {
        float size = 90f * s;
        float inset = 44f * s;
        float border = Math.max(3f, 7f * s);
        float radius = 22f * s;
        float half = border / 2f;
        float r = Math.max(0f, radius - half);

        stroke.reset();
        stroke.setAntiAlias(true);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(border);
        stroke.setStrokeCap(Paint.Cap.BUTT);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        for (int k = 0; k < 4; k++) {
            double intro = ramp(t, 0.1 + 0.08 * k, 0.65);
            if (intro <= 0) continue;
            float grow = (float) easeOutCubic(intro);
            int dx = CLEAN_CORNERS[k][0];
            int dy = CLEAN_CORNERS[k][1];
            float o = cleanBracketOffset(k, t);
            float x = (dx > 0 ? inset : width - inset) - dx * o;
            float y = (dy > 0 ? inset : height - inset) - dy * o;
            float cx = x + dx * half;
            float cy = y + dy * half;
            path.reset();
            path.moveTo(x + dx * size, cy);
            path.lineTo(cx + dx * r, cy);
            path.quadTo(cx, cy, cx, cy + dy * r);
            path.lineTo(cx, y + dy * size);
            stroke.setColor(withAlpha(Color.WHITE, 0.95 * grow));
            // drop-shadow(0 1px 4px rgba(0,0,0,0.55))
            stroke.setShadowLayer(2f, 0f, 1f, Color.argb(Math.round(140 * grow), 0, 0, 0));
            strokeSegment(path, 0.5f - grow / 2f, 0.5f + grow / 2f, stroke);
        }
        stroke.clearShadowLayer();

        double ripplesIn = ramp(t, 0.6, 0.6);
        if (ripplesIn > 0) {
            float ringWidth = Math.max(2f, 2.5f * s);
            stroke.setStrokeWidth(ringWidth);
            for (double delay : new double[] { 0d, 1.8d }) {
                float p = (float) (((t + delay) % 3.6d) / 3.6d);
                float diameter = (0.15f + 0.85f * p) * Math.min(width, height) * 0.32f;
                float opacity = p < 0.15f ? (p / 0.15f) * 0.5f : 0.5f * (1f - (p - 0.15f) / 0.85f);
                stroke.setColor(withAlpha(template.accent, opacity * ripplesIn));
                canvas.drawCircle(width * 0.13f, height * 0.84f,
                    Math.max(0f, diameter / 2f - ringWidth / 2f), stroke);
            }
        }

        drawSceneProgress(t);
    }

    private void drawSceneProgress(double t) {
        double appear = easeOutCubic(ramp(t, 0.3, 0.5));
        if (appear <= 0) return;
        if (Double.isNaN(end)) {
            fill.reset();
            fill.setAntiAlias(true);
            fill.setColor(withAlpha(template.accent, 0.9 * appear));
            canvas.drawRoundRect(new RectF((width - 56f * s) / 2f, 54f * s,
                (width + 56f * s) / 2f, 59f * s), 2.5f * s, 2.5f * s, fill);
            return;
        }
        float thickness = 5f * s;
        float y = 54f * s + thickness / 2f;
        float total = 240f * s;
        float gap = 10f * s;
        int count = Math.min(sceneCount(beats), 12);
        float seg = (total - gap * (count - 1)) / count;
        if (seg < 12f * s) {
            count = 1;
            seg = total;
        }
        float left = (width - total) / 2f;
        boolean continuous = count == 1;
        int index = sceneIndex(t, beats);
        double fraction = continuous ? videoProgress(t, end) : sceneFraction(t, beats, end);

        stroke.reset();
        stroke.setAntiAlias(true);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeWidth(thickness);
        for (int i = 0; i < count; i++) {
            float x0 = left + i * (seg + gap);
            float a = x0 + thickness / 2f;
            float b = x0 + seg - thickness / 2f;
            stroke.setColor(Color.argb((int) Math.round(255 * 0.3 * appear), 255, 255, 255));
            canvas.drawLine(a, y, b, y, stroke);
            double f = continuous ? fraction : i < index ? 1 : i == index ? fraction : 0;
            if (f > 0) {
                stroke.setColor(withAlpha(template.accent, 0.95 * appear));
                canvas.drawLine(a, y, (float) (a + (b - a) * f), y, stroke);
            }
        }
    }

    // ── framed_cream ────────────────────────────────────────────────────────

    /** [from, to, alpha] of the accent stroke round the card. */
    private double[] creamCardStroke(double t) {
        double close = outro(t, end, 1.4);
        if (close > 0) return new double[] { 0, easeInOutCubic(close), 0.9 };
        double p = beatProgress(t, beats, 0.15, 1.1);
        if (p < 0) return new double[] { 0, 0, 0 };
        double head = easeInOutCubic(p);
        return new double[] { Math.max(0, head - 0.22), head, 1 - ramp(p, 0.8, 0.2) };
    }

    private Path windowHole() {
        Path hole = new Path();
        hole.setFillType(Path.FillType.EVEN_ODD);
        hole.addRect(0, 0, width, height, Path.Direction.CW);
        hole.addRoundRect(insetWindow(), WINDOW_RADIUS, WINDOW_RADIUS, Path.Direction.CW);
        return hole;
    }

    private void drawFramedCream(double t) {
        RectF cardR = cardRect();
        RectF win = insetWindow();
        float shortSide = Math.min(width, height);

        if (base == null) {
            // The warm canvas, window left open.
            base = newLayer();
            Canvas c = new Canvas(base);
            Paint wash = new Paint(Paint.ANTI_ALIAS_FLAG);
            wash.setShader(new LinearGradient(0, 0, width, height, template.neutral,
                mix(template.neutral, template.secondary, 0.22f), Shader.TileMode.CLAMP));
            c.drawPath(windowHole(), wash);
        }
        if (card == null) {
            card = newLayer();
            Canvas c = new Canvas(card);
            Paint white = new Paint(Paint.ANTI_ALIAS_FLAG);
            white.setColor(Color.WHITE);
            // 0 16px 42px rgba(0,0,0,0.22)
            white.setShadowLayer(21f, 0f, 16f, Color.argb(56, 0, 0, 0));
            Path ring = new Path();
            ring.setFillType(Path.FillType.EVEN_ODD);
            ring.addRoundRect(cardR, CARD_RADIUS, CARD_RADIUS, Path.Direction.CW);
            ring.addRoundRect(win, WINDOW_RADIUS, WINDOW_RADIUS, Path.Direction.CW);
            c.drawPath(ring, white);
        }
        canvas.drawBitmap(base, 0, 0, blit);

        // Colour blobs drifting in the margins, never inside the window.
        double appear = easeOutCubic(ramp(t, 0, 0.8));
        canvas.save();
        canvas.clipRect(0, 0, width, height);
        path.reset();
        path.addRoundRect(win, WINDOW_RADIUS, WINDOW_RADIUS, Path.Direction.CW);
        canvas.clipPath(path, Region.Op.DIFFERENCE);
        fill.reset();
        fill.setAntiAlias(true);
        fill.setColor(withAlpha(template.accent, 0.16 * appear));
        canvas.drawCircle((float) (width * 0.92 + 14 * s * wave(t, 7)),
            (float) (height * 0.05 + 10 * s * wave(t, 7, 0.25)), shortSide * 0.2f, fill);
        fill.setColor(withAlpha(template.primary, 0.12 * appear));
        canvas.drawCircle((float) (width * 0.06 + 12 * s * wave(t, 9, 0.25)),
            (float) (height * 0.93 + 10 * s * wave(t, 9)), shortSide * 0.24f, fill);
        canvas.restore();

        canvas.drawBitmap(card, 0, 0, blit);

        // Accent comet round the card on every cut; full outline at the end.
        double[] cs = creamCardStroke(t);
        if (cs[1] > cs[0] && cs[2] > 0) {
            RectF outline = new RectF(cardR.left + 1.5f * s, cardR.top + 1.5f * s,
                cardR.right - 1.5f * s, cardR.bottom - 1.5f * s);
            roundRectFromTop(path, outline, CARD_RADIUS);
            stroke.reset();
            stroke.setAntiAlias(true);
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeCap(Paint.Cap.ROUND);
            stroke.setStrokeWidth(Math.max(2f, 4f * s));
            stroke.setColor(withAlpha(template.accent, cs[2]));
            strokeSegment(path, (float) cs[0], (float) cs[1], stroke);
        }

        double draw = ramp(t, 0.2, 1.4);
        int ink = template.primary;
        float strokeWidth = Math.max(2.5f, 3.2f * s);
        float dash = width * 2f;
        stroke.reset();
        stroke.setAntiAlias(true);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);

        // The branch: draws on, then sways about its base (0, 60).
        double sway = 2.5 * wave(t, 5) * ramp(t, 1.2, 0.8);
        canvas.save();
        canvas.translate(width * 0.66f, height * 0.9f);
        canvas.scale(s, s);
        canvas.rotate((float) sway, 0f, 60f);
        stroke.setStrokeWidth(strokeWidth);
        stroke.setColor(withAlpha(ink, 0.6));
        float visible = (float) (draw * dash);
        path.reset();
        path.moveTo(0f, 60f);
        path.cubicTo(60f, 44f, 120f, 40f, 190f, 6f);
        strokeLength(path, visible, stroke);
        float[][] leaves = { { 46, 48, 52, 26, 32, 18 }, { 84, 40, 92, 18, 72, 8 },
            { 124, 30, 134, 8, 114, -4 }, { 162, 16, 172, -4, 154, -16 } };
        for (float[] l : leaves) {
            path.reset();
            path.moveTo(l[0], l[1]);
            path.quadTo(l[2], l[3], l[4], l[5]);
            strokeLength(path, visible, stroke);
        }
        canvas.restore();

        // The wave: draws on, then drifts.
        float segmentW = width * 0.11f;
        float amplitude = 14f * s;
        float drift = (float) (8 * s * wave(t, 6) * ramp(t, 1.6, 0.6));
        float wy = height * 0.945f;
        path.reset();
        path.moveTo(width * 0.14f + drift, wy);
        for (int k = 0; k < 3; k++) {
            path.rQuadTo(segmentW / 2f, -amplitude, segmentW, 0f);
            path.rQuadTo(segmentW / 2f, amplitude, segmentW, 0f);
        }
        stroke.setStrokeWidth(strokeWidth);
        stroke.setColor(withAlpha(ink, 0.55));
        strokeLength(path, visible, stroke);

        // Three dots, bobbing out of phase.
        fill.reset();
        fill.setAntiAlias(true);
        fill.setColor(withAlpha(ink, 0.5 * draw));
        float[][] dots = { { 0.12f, 0.9f, 4f }, { 0.16f, 0.93f, 3f }, { 0.1f, 0.955f, 3f } };
        for (int k = 0; k < dots.length; k++) {
            float bob = (float) (4 * s * wave(t, 2.8, k / 3d));
            canvas.drawCircle(width * dots[k][0], height * dots[k][1] + bob, dots[k][2] * s, fill);
        }

        // Sparkles: twinkle, and pop on every cut.
        double pop = 0.5 * beatEnvelope(t, beats, 0.06, 0.45);
        float[][] sparkles = { { width * 0.1f, height * 0.04f, 16f * s, 0f, 0.8f },
            { width * 0.88f, height * 0.035f, 10f * s, 0.5f, 0.65f } };
        for (float[] sp : sparkles) {
            float scale = (float) (1 + 0.15 * wave(t, 2.4, sp[3]) + pop);
            float spin = (float) (12 * wave(t, 4.8, sp[3]));
            canvas.save();
            canvas.translate(sp[0], sp[1]);
            canvas.rotate(spin);
            canvas.scale(scale, scale);
            fill.setColor(withAlpha(template.accent, sp[4] * draw));
            star4(path, sp[2]);
            canvas.drawPath(path, fill);
            canvas.restore();
        }
    }

    // ── editorial ───────────────────────────────────────────────────────────

    private Typeface counterFace;

    private Typeface counterTypeface() {
        if (counterFace == null) {
            counterFace = Build.VERSION.SDK_INT >= 28
                ? Typeface.create(Typeface.DEFAULT, 800, false)
                : Typeface.create(Typeface.DEFAULT, Typeface.BOLD);
        }
        return counterFace;
    }

    private void drawEditorial(double t) {
        if (base == null) {
            base = newLayer();
            Canvas c = new Canvas(base);
            Paint top = new Paint();
            top.setShader(new LinearGradient(0, 0, 0, height * 0.20f,
                Color.argb(107, 0, 0, 0), Color.TRANSPARENT, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, width, height * 0.20f, top);
            Paint bottom = new Paint();
            bottom.setShader(new LinearGradient(0, height, 0, height * 0.70f,
                Color.argb(140, 0, 0, 0), Color.TRANSPARENT, Shader.TileMode.CLAMP));
            c.drawRect(0, height * 0.70f, width, height, bottom);
        }
        canvas.drawBitmap(base, 0, 0, blit);

        float inset = Math.round(Math.min(width, height) * 0.045f);
        float border = Math.max(2f, 2.4f * s);
        RectF frame = new RectF(inset, inset, width - inset, height - inset);
        stroke.reset();
        stroke.setAntiAlias(true);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.BUTT);
        double draw = easeInOutCubic(ramp(t, 0.2, 1.3));
        if (draw > 0) {
            roundRectFromTop(path, frame, 18f * s);
            stroke.setStrokeWidth(border);
            stroke.setColor(withAlpha(template.neutral, 0.85));
            strokeSegment(path, 0f, (float) draw, stroke);
        }
        double close = easeInOutCubic(outro(t, end, 1.4));
        if (close > 0) {
            roundRectFromTop(path, frame, 18f * s);
            stroke.setStrokeWidth(border * 1.6f);
            stroke.setColor(withAlpha(template.accent, 0.95));
            strokeSegment(path, 0f, (float) close, stroke);
        }

        // Kicker: the dot pops and pulses on cuts; the rule extends.
        fill.reset();
        fill.setAntiAlias(true);
        fill.setColor(template.accent);
        double dotScale = easeOutBack(ramp(t, 0.35, 0.45)) * (1 + 0.6 * beatEnvelope(t, beats, 0.05, 0.45));
        if (dotScale > 0) {
            canvas.drawCircle(inset + 34f * s, inset + 42f * s, (float) (6f * s * dotScale), fill);
        }
        // The rule: a round-capped 5s line whose 91s straight part extends.
        double rule = clamp01((96 * easeOutCubic(ramp(t, 0.5, 0.6)) - 5) / 91);
        if (rule > 0) {
            stroke.setStrokeCap(Paint.Cap.ROUND);
            stroke.setStrokeWidth(5f * s);
            stroke.setColor(template.accent);
            float x0 = inset + 52.5f * s;
            float y0 = inset + 41.5f * s;
            canvas.drawLine(x0, y0, (float) (x0 + 91f * s * rule), y0, stroke);
        }

        drawSceneCounter(t, inset);
    }

    private static String twoDigits(int n) {
        return n < 10 ? "0" + n : String.valueOf(n);
    }

    /** [dy, alpha] of number k's roll. */
    private double[] counterRoll(double t, int k) {
        double dy = 0;
        double alpha = 1;
        if (k > 0) {
            double e = easeOutCubic(ramp(t, beats[k - 1] - 0.12, 0.35));
            dy += (1 - e) * 18 * s;
            alpha *= e;
        }
        if (k < beats.length) {
            double e = easeOutCubic(ramp(t, beats[k] - 0.12, 0.35));
            dy -= e * 18 * s;
            alpha *= 1 - e;
        }
        return new double[] { dy, alpha };
    }

    private void drawSceneCounter(double t, float inset) {
        int scenes = sceneCount(beats);
        if (scenes < 2) return;
        double appear = easeOutCubic(ramp(t, 0.6, 0.5));
        if (appear <= 0) return;
        float size = 30f * s;
        float right = width - inset - 34f * s;
        float baseline = inset + 42f * s + size * 0.36f;
        float lift = (float) ((1 - appear) * 12 * s);
        fill.reset();
        fill.setAntiAlias(true);
        fill.setTypeface(counterTypeface());
        fill.setTextSize(size);
        fill.setTextAlign(Paint.Align.RIGHT);
        String total = "/ " + twoDigits(scenes);
        fill.setColor(withAlpha(template.neutral, 0.7 * appear));
        canvas.drawText(total, right, baseline + lift, fill);
        float numberRight = right - fill.measureText(total) - 10f * s;
        int index = sceneIndex(t, beats);
        for (int k = Math.max(0, index - 1); k <= index; k++) {
            double[] roll = counterRoll(t, k);
            if (roll[1] <= 0) continue;
            fill.setColor(withAlpha(Color.WHITE, roll[1] * appear));
            canvas.drawText(twoDigits(k + 1), numberRight, (float) (baseline + lift + roll[0]), fill);
        }
        fill.setTextAlign(Paint.Align.LEFT);
    }

    // ── bold_pop ────────────────────────────────────────────────────────────

    private static final float[] POP_STRIPE_LENGTHS = { 300f, 220f, 150f };
    private static final float POP_CONFETTI_SIZE = 1.4f;
    /** x, y (fractions), kind, colour (0 primary 1 secondary 2 accent), base rotation. */
    private static final float[][] POP_CONFETTI = {
        { 0.86f, 0.2f, 0, 2, 0 },
        { 0.08f, 0.36f, 1, 1, 20 },
        { 0.9f, 0.52f, 2, 0, 40 },
        { 0.14f, 0.62f, 3, 1, 0 },
        { 0.8f, 0.7f, 4, 2, 80 },
    };

    private int paletteColor(int key) {
        return key == 0 ? template.primary : key == 1 ? template.secondary : template.accent;
    }

    private void drawBoldPop(double t) {
        int[] colors = { template.primary, template.secondary, template.accent };
        float thickness = 20f * s;
        float[][] groups = {
            { -80f * s, 210f * s, -45f, 1f },
            { width + 80f * s, height - 170f * s, 135f, 0.75f },
        };
        stroke.reset();
        stroke.setAntiAlias(true);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        for (int g = 0; g < groups.length; g++) {
            canvas.save();
            canvas.translate(groups[g][0], groups[g][1]);
            canvas.rotate(groups[g][2]);
            canvas.scale(groups[g][3], groups[g][3]);
            stroke.setStrokeWidth(thickness);
            for (int i = 0; i < 3; i++) {
                double draw = easeOutCubic(ramp(t, 0.05 + 0.09 * i + 0.12 * g, 0.5));
                if (draw <= 0) continue;
                float slide = (float) ((12 * wave(t, 3.2, i * 0.18) * ramp(t, 0.8, 0.5)
                    + 26 * beatEnvelope(t, beats, 0.06, 0.4)) * s);
                float y = i * 30f * s;
                stroke.setColor(colors[i]);
                canvas.drawLine(slide, y, (float) (slide + POP_STRIPE_LENGTHS[i] * s * draw), y, stroke);
            }
            canvas.restore();
        }

        // Confetti; the last second gets one extra pop.
        double[] confettiBeats = beats;
        if (!Double.isNaN(end) && end > 2) {
            confettiBeats = java.util.Arrays.copyOf(beats, beats.length + 1);
            confettiBeats[beats.length] = end - 1;
        }
        stroke.setStrokeJoin(Paint.Join.ROUND);
        fill.reset();
        fill.setAntiAlias(true);
        for (int k = 0; k < POP_CONFETTI.length; k++) {
            float[] c = POP_CONFETTI[k];
            double scale = easeOutBack(ramp(t, 0.35 + 0.08 * k, 0.45))
                + 0.35 * beatEnvelope(t, confettiBeats, 0.05, 0.4);
            if (scale <= 0) continue;
            float dy = (float) (8 * s * wave(t, 2.6, k * 0.21));
            float rot = (float) (c[4] + 15 * wave(t, 5, k * 0.13));
            int kind = (int) c[2];
            int color = paletteColor((int) c[3]);
            canvas.save();
            canvas.translate(width * c[0], height * c[1] + dy);
            canvas.rotate(rot);
            canvas.scale((float) scale, (float) scale);
            confettiPath(path, kind, s * POP_CONFETTI_SIZE);
            if (kind == 3) {
                fill.setColor(color);
                canvas.drawPath(path, fill);
            } else {
                stroke.setStrokeWidth((kind == 1 ? 8f : 6f) * s);
                stroke.setColor(color);
                canvas.drawPath(path, stroke);
            }
            canvas.restore();
        }

        // The bottom progress line with its leading dot.
        if (!Double.isNaN(end)) {
            double appear = easeOutCubic(ramp(t, 0.2, 0.5));
            float p = (float) videoProgress(t, end);
            float y = height - 6f * s;
            fill.setColor(Color.argb((int) Math.round(255 * 0.25 * appear), 0, 0, 0));
            canvas.drawRect(0, y - 6f * s, width, y + 6f * s, fill);
            fill.setColor(withAlpha(template.accent, appear));
            canvas.drawRect(0, y - 6f * s, width * p, y + 6f * s, fill);
            float dot = (float) (10 * s * (1 + 0.3 * beatEnvelope(t, beats, 0.05, 0.4)) * appear);
            fill.setColor(template.secondary);
            canvas.drawCircle(width * p, y, dot, fill);
        }

        // The slanted colour wipe across every cut.
        double p = beatProgress(t, beats, 0.22, 0.44);
        if (p >= 0) {
            float cx = (float) (-0.35 * width + 1.7 * width * easeInOutCubic(p));
            float bw = 0.2f * width;
            band(cx - bw * 0.95f, bw * 0.35f, withAlpha(template.secondary, 0.9));
            band(cx, bw, withAlpha(template.accent, 0.92));
        }
    }

    private void band(float center, float bandWidth, int color) {
        float shear = 0.12f * height;
        path.reset();
        path.moveTo(center - bandWidth / 2f + shear, 0f);
        path.lineTo(center + bandWidth / 2f + shear, 0f);
        path.lineTo(center + bandWidth / 2f - shear, height);
        path.lineTo(center - bandWidth / 2f - shear, height);
        path.close();
        fill.setColor(color);
        canvas.drawPath(path, fill);
    }

    /** ring 0, plus 1, triangle 2, dot 3, zigzag 4 — centred on the origin. */
    private static void confettiPath(Path p, int kind, float u) {
        p.reset();
        switch (kind) {
            case 0:
                p.addCircle(0f, 0f, 16f * u, Path.Direction.CW);
                break;
            case 3:
                p.addCircle(0f, 0f, 9f * u, Path.Direction.CW);
                break;
            case 1:
                p.moveTo(-18f * u, 0f);
                p.lineTo(18f * u, 0f);
                p.moveTo(0f, -18f * u);
                p.lineTo(0f, 18f * u);
                break;
            case 2: {
                float r = 18f * u;
                p.moveTo(0f, -r);
                p.lineTo(r * 0.866f, r * 0.5f);
                p.lineTo(-r * 0.866f, r * 0.5f);
                p.close();
                break;
            }
            default:
                p.moveTo(-20f * u, 5f * u);
                p.lineTo(-10f * u, -5f * u);
                p.lineTo(0f, 5f * u);
                p.lineTo(10f * u, -5f * u);
                p.lineTo(20f * u, 5f * u);
                break;
        }
    }

    // ── cinematic ───────────────────────────────────────────────────────────

    private float cinemaBarHeight() {
        if ((float) height / width >= 1.5f) return 0.06f * height;
        if ((float) width / height > 1.5f) return 0.1f * height;
        return 0.075f * height;
    }

    private void drawCinematic(double t) {
        float reach = (float) Math.hypot(width / 2f, height / 2f);

        // Light leak, under the vignette and bars.
        double lx = width * (0.85 - 0.35 * (0.5 + 0.5 * wave(t, 11)));
        double ly = height * (0.08 + 0.12 * (0.5 + 0.5 * wave(t, 11, 0.25)));
        double la = (0.22 + 0.08 * wave(t, 5.5)) * ramp(t, 0.3, 1.2);
        fill.reset();
        fill.setAntiAlias(true);
        if (la > 0) {
            float R = 0.7f * Math.max(width, height);
            int c = template.secondary;
            fill.setShader(new RadialGradient((float) lx, (float) ly, R,
                new int[] { withAlpha(c, la), withAlpha(c, la * 0.35), withAlpha(c, 0) },
                new float[] { 0f, 0.5f, 1f }, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, width, height, fill);
            fill.setShader(null);
        }

        if (base == null) {
            base = newLayer();
            Canvas c = new Canvas(base);
            Paint vignette = new Paint(Paint.ANTI_ALIAS_FLAG);
            vignette.setShader(new RadialGradient(width / 2f, height / 2f, reach,
                new int[] { Color.TRANSPARENT, Color.TRANSPARENT, Color.argb(107, 0, 0, 0) },
                new float[] { 0f, 0.45f, 1f }, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, width, height, vignette);
        }
        canvas.drawBitmap(base, 0, 0, blit);

        // The anamorphic flare across every cut.
        double p = beatProgress(t, beats, 0.25, 0.75);
        if (p >= 0) {
            double env = Math.sin(Math.PI * p);
            float cx = (float) (width * (0.35 + 0.3 * p));
            float cy = height * 0.42f;
            fill.setColor(Color.argb((int) Math.round(255 * 0.08 * env), 255, 255, 255));
            canvas.drawRect(0, 0, width, height, fill);
            float gr = width * 0.55f;
            canvas.save();
            canvas.translate(cx, cy);
            canvas.scale(1f, (70f * s) / gr);
            fill.setShader(new RadialGradient(0f, 0f, gr,
                withAlpha(template.accent, 0.45 * env), withAlpha(template.accent, 0), Shader.TileMode.CLAMP));
            canvas.drawRect(-gr, -gr, gr, gr, fill);
            fill.setShader(null);
            canvas.restore();
            int core = Color.argb((int) Math.round(255 * 0.9 * env), 255, 255, 255);
            fill.setShader(new LinearGradient(cx - width * 0.45f, 0, cx + width * 0.45f, 0,
                new int[] { Color.argb(0, 255, 255, 255), core, Color.argb(0, 255, 255, 255) },
                new float[] { 0f, 0.5f, 1f }, Shader.TileMode.CLAMP));
            canvas.drawRect(cx - width * 0.45f, cy - 1.5f * s, cx + width * 0.45f, cy + 1.5f * s, fill);
            fill.setShader(null);
        }

        double close = outro(t, end, 1.4);
        if (close > 0) {
            fill.setColor(Color.argb((int) Math.round(255 * 0.22 * easeInOutCubic(close)), 0, 0, 0));
            canvas.drawRect(0, 0, width, height, fill);
        }

        // Letterbox bars and their accent hairlines.
        float barH = cinemaBarHeight();
        float bar = (float) (barH * easeOutCubic(ramp(t, 0, 0.9))
            + 0.4 * barH * easeInOutCubic(outro(t, end, 1.4)));
        if (bar > 0) {
            fill.setColor(Color.BLACK);
            canvas.drawRect(0, 0, width, bar, fill);
            canvas.drawRect(0, height - bar, width, height, fill);
            float line = (float) (width * 0.5 * easeInOutCubic(ramp(t, 0.7, 0.9)));
            if (line > 0) {
                fill.setColor(withAlpha(template.accent, 0.85));
                float h = Math.max(1.5f, 2f * s);
                canvas.drawRect(width / 2f - line, bar - h, width / 2f + line, bar, fill);
                canvas.drawRect(width / 2f - line, height - bar, width / 2f + line, height - bar + h, fill);
            }
        }
    }
}
