package com.rclipper.app.render;

import android.graphics.Bitmap;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.graphics.Shader;

/**
 * Draws the motion-graphic template layer exactly as the server's styled render
 * draws it.
 *
 * THE REFERENCE IS `remotion/TemplatedVideo.tsx`. That is the composition the
 * server's `_renderCaptionedRatio` renders for every delivered video, so every
 * position, size, colour, opacity and timing below is read off it — not off the
 * catalogue's descriptive `frame`/`decor` fields, which name the look but do not
 * lay it out. The template is chosen by id, as the composition chooses it.
 *
 *   clean_frame  — four white corner brackets that ease in over 0.7 s, two
 *                  accent ripples pulsing from the bottom-left every 3.6 s, and
 *                  a short accent bar at the top centre.
 *   framed_cream — the video inset in a white rounded card on the palette's warm
 *                  neutral canvas, with a botanical branch, a wave and three
 *                  dots drawn on in the bottom margin and an accent sparkle.
 *   editorial    — top and bottom scrims, a hairline rounded frame that draws
 *                  itself on, and an accent kicker (dot + rule) top-left.
 *   none         — nothing.
 *
 * Lengths use Remotion's own scale, `s = min(width, height) / 1080`, so a 16:9
 * export is laid out like the Mac's rather than shrunk to 56 %.
 *
 * ANIMATION. Everything that moves in the composition moves here, as a function
 * of the frame time: the draw-on strokes (via {@link PathMeasure}), the bracket
 * ease-in, and the ripples. Once a template has settled — every template except
 * clean_frame, whose ripples never stop — the last frame is kept and handed back
 * unchanged, so the steady state costs nothing.
 *
 * THE INSET. framed_cream shows the video INSIDE a card. The picture itself is
 * scaled into the card's window by {@link #insetTransform} (a GL matrix applied
 * before the overlay); this painter draws the canvas and the card around a
 * transparent window, so the scaled video shows through exactly where the
 * composition's `objectFit: cover` puts it.
 */
public final class TemplatePainter {

    private static final float REFERENCE_SHORT_SIDE = 1080f;

    private final RenderManifest.Template template;
    private final int width;
    private final int height;
    /** Remotion's short-side scale. */
    private final float s;

    private Bitmap bitmap;
    private Canvas canvas;
    /** The time the cached bitmap was last drawn for; NaN = never. */
    private double drawnAt = Double.NaN;
    private boolean settledDrawn;

    public TemplatePainter(RenderManifest.Template template, int width, int height) {
        this.template = template;
        this.width = width;
        this.height = height;
        this.s = Math.min(width, height) / REFERENCE_SHORT_SIDE;
    }

    /** The composition's template id, with the catalogue's frame as a fallback. */
    private String look() {
        String id = template.id == null ? "none" : template.id;
        switch (id) {
            case "clean_frame":
            case "framed_cream":
            case "editorial":
            case "none":
                return id;
            default:
                // An id this build does not know: fall back to the frame it
                // declares, so a new template still gets its nearest look.
                if ("rounded_inset".equals(template.frame)) return "framed_cream";
                if ("corner_bracket".equals(template.frame)) return "clean_frame";
                return "none";
        }
    }

    /** True when there is nothing to draw, so the overlay can be skipped. */
    public boolean isEmpty() {
        return "none".equals(look());
    }

    /** framed_cream insets the video in a card; the others are full-bleed. */
    public boolean isInset() {
        return "framed_cream".equals(look());
    }

    /**
     * The video's window inside the card, in output pixels: the card sits at
     * top 6.5 %, left/right 5.5 %, bottom 13 %, with 22 px of white padding and
     * a 22 px corner inside it.
     */
    public RectF insetWindow() {
        RectF card = cardRect();
        float padding = 22f;
        return new RectF(card.left + padding, card.top + padding,
            card.right - padding, card.bottom - padding);
    }

    private RectF cardRect() {
        return new RectF(width * 0.055f, height * 0.065f, width * (1f - 0.055f), height * (1f - 0.13f));
    }

    /**
     * The GL (NDC) matrix that scales the full-frame video into
     * {@link #insetWindow}, cover-fitted and centred — the composition's
     * `objectFit: cover` inside the card. Whatever spills past the window is
     * hidden under the card and canvas this painter draws on top.
     */
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
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        bitmap = null;
        canvas = null;
    }

    /** Past this, every look except clean_frame's ripples is at rest. */
    private static final double SETTLED_SECONDS = 1.7d;

    /**
     * The template layer at `seconds`. The same bitmap object is reused and
     * redrawn in place; Media3's BitmapOverlay re-uploads it when its
     * generation id changes, and skips the upload when it does not.
     */
    public Bitmap draw(double seconds) {
        if (isEmpty()) return null;
        boolean animating = "clean_frame".equals(look()) || seconds < SETTLED_SECONDS;
        if (bitmap != null && !animating && settledDrawn) return bitmap;
        if (bitmap != null && !Double.isNaN(drawnAt) && Math.abs(drawnAt - seconds) < 1e-6) {
            return bitmap;
        }
        if (bitmap == null) {
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            canvas = new Canvas(bitmap);
        }
        double t = animating ? seconds : SETTLED_SECONDS;
        bitmap.eraseColor(Color.TRANSPARENT);
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
            default:
                break;
        }
        drawnAt = seconds;
        settledDrawn = !animating;
        return bitmap;
    }

    // ── clean_frame ─────────────────────────────────────────────────────────

    private void drawCleanFrame(double t) {
        float draw = clamp01((float) (t / 0.7d));

        // Corner brackets: 90 s-px boxes with two borders and a rounded corner,
        // sliding 20 s-px in from the corner while they fade up to 0.95.
        float size = 90f * s;
        float inset = 44f * s;
        float border = Math.max(3f, 7f * s);
        float off = (1f - draw) * 20f * s;
        float radius = 22f * s;
        int bracketAlpha = Math.round(255 * draw * 0.95f);

        Paint shadow = new Paint(Paint.ANTI_ALIAS_FLAG);
        shadow.setStyle(Paint.Style.STROKE);
        shadow.setStrokeWidth(border);
        shadow.setColor(Color.argb(Math.round(140 * draw * 0.95f), 0, 0, 0));
        shadow.setMaskFilter(new BlurMaskFilter(Math.max(1f, 4f), BlurMaskFilter.Blur.NORMAL));

        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(border);
        stroke.setColor(Color.argb(bracketAlpha, 255, 255, 255));

        float left = inset - off;
        float top = inset - off;
        float right = width - inset + off;
        float bottom = height - inset + off;
        Path[] brackets = new Path[] {
            bracket(left, top, size, border, radius, 1, 1),
            bracket(right, top, size, border, radius, -1, 1),
            bracket(left, bottom, size, border, radius, 1, -1),
            bracket(right, bottom, size, border, radius, -1, -1),
        };
        for (Path path : brackets) {
            // drop-shadow(0 1px 4px rgba(0,0,0,0.55))
            canvas.save();
            canvas.translate(0f, 1f);
            canvas.drawPath(path, shadow);
            canvas.restore();
            canvas.drawPath(path, stroke);
        }

        // Two ripples pulsing from the bottom-left, 1.8 s apart.
        float rippleX = width * 0.13f;
        float rippleY = height * 0.84f;
        float ringWidth = Math.max(2f, 2.5f * s);
        Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(ringWidth);
        for (double delay : new double[] { 0d, 1.8d }) {
            double period = 3.6d;
            float p = (float) (((t + delay) % period) / period);
            float diameter = (0.15f + 0.85f * p) * Math.min(width, height) * 0.32f;
            float opacity = p < 0.15f ? (p / 0.15f) * 0.5f : 0.5f * (1f - (p - 0.15f) / 0.85f);
            ring.setColor(withAlpha(template.accent, opacity));
            // A CSS border sits inside its box, so the stroke's centre line is
            // half a border in from the box edge.
            canvas.drawCircle(rippleX, rippleY, Math.max(0f, diameter / 2f - ringWidth / 2f), ring);
        }

        // The accent bar at the top centre.
        Paint bar = new Paint(Paint.ANTI_ALIAS_FLAG);
        bar.setColor(withAlpha(template.accent, draw * 0.9f));
        float barWidth = 56f * s;
        float barHeight = 5f * s;
        canvas.drawRoundRect(
            new RectF((width - barWidth) / 2f, 54f * s, (width + barWidth) / 2f, 54f * s + barHeight),
            5f * s, 5f * s, bar);
    }

    /**
     * One corner bracket: a `size` box showing only the two borders that meet
     * at the corner (x, y), with a rounded outer corner. dx/dy point from the
     * corner into the frame. The path runs along the border's centre line.
     */
    private static Path bracket(
        float x, float y, float size, float border, float radius, int dx, int dy
    ) {
        float half = border / 2f;
        float cx = x + dx * half;
        float cy = y + dy * half;
        float r = Math.max(0f, radius - half);
        Path path = new Path();
        path.moveTo(x + dx * size, cy);
        path.lineTo(cx + dx * r, cy);
        path.quadTo(cx, cy, cx, cy + dy * r);
        path.lineTo(cx, y + dy * size);
        return path;
    }

    // ── framed_cream ────────────────────────────────────────────────────────

    private void drawFramedCream(double t) {
        // The canvas around the card, with the card's window punched out.
        int canvasColor = template.neutral;
        RectF card = cardRect();
        RectF window = insetWindow();

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(canvasColor);
        canvas.drawRect(0, 0, width, height, fill);

        // The card's shadow: 0 16px 42px rgba(0,0,0,0.22).
        Paint shadow = new Paint(Paint.ANTI_ALIAS_FLAG);
        shadow.setColor(Color.argb(56, 0, 0, 0));
        shadow.setMaskFilter(new BlurMaskFilter(21f, BlurMaskFilter.Blur.NORMAL));
        canvas.drawRoundRect(
            new RectF(card.left, card.top + 16f, card.right, card.bottom + 16f), 34f, 34f, shadow);

        Paint white = new Paint(Paint.ANTI_ALIAS_FLAG);
        white.setColor(Color.WHITE);
        canvas.drawRoundRect(card, 34f, 34f, white);

        Paint clear = new Paint(Paint.ANTI_ALIAS_FLAG);
        clear.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
        canvas.drawRoundRect(window, 22f, 22f, clear);

        float draw = clamp01((float) ((t - 0.2d) / 1.4d));
        int ink = template.primary;
        float strokeWidth = Math.max(2.5f, 3.2f * s);
        float dash = width * 2f;

        Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeCap(Paint.Cap.ROUND);

        // The botanical branch, drawn in its own units and scaled by s — its
        // stroke width and dash are in those units too, as in the SVG group.
        canvas.save();
        canvas.translate(width * 0.66f, height * 0.9f);
        canvas.scale(s, s);
        line.setStrokeWidth(strokeWidth);
        line.setColor(withAlpha(ink, 0.6f));
        Path branch = new Path();
        branch.moveTo(0f, 60f);
        branch.cubicTo(60f, 44f, 120f, 40f, 190f, 6f);
        drawOn(branch, dash, draw, line);
        drawOn(quad(46f, 48f, 6f, -22f, -14f, -30f), dash, draw, line);
        drawOn(quad(84f, 40f, 8f, -22f, -12f, -32f), dash, draw, line);
        drawOn(quad(124f, 30f, 10f, -22f, -10f, -34f), dash, draw, line);
        drawOn(quad(162f, 16f, 10f, -20f, -8f, -32f), dash, draw, line);
        canvas.restore();

        // The long, low wave across the bottom margin.
        float waveY = height * 0.945f;
        float segment = width * 0.11f;
        float amplitude = 14f * s;
        Path wave = new Path();
        wave.moveTo(width * 0.14f, waveY);
        for (int k = 0; k < 3; k++) {
            wave.rQuadTo(segment / 2f, -amplitude, segment, 0f);
            wave.rQuadTo(segment / 2f, amplitude, segment, 0f);
        }
        line.setStrokeWidth(strokeWidth);
        line.setColor(withAlpha(ink, 0.55f));
        drawOn(wave, dash, draw, line);

        // Three dots on the left.
        Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        dot.setColor(withAlpha(ink, 0.5f * draw));
        canvas.drawCircle(width * 0.12f, height * 0.9f, 4f * s, dot);
        canvas.drawCircle(width * 0.16f, height * 0.93f, 3f * s, dot);
        canvas.drawCircle(width * 0.10f, height * 0.955f, 3f * s, dot);

        // The accent sparkle, top-left.
        Paint sparkle = new Paint(Paint.ANTI_ALIAS_FLAG);
        sparkle.setColor(withAlpha(template.accent, 0.8f * draw));
        canvas.drawPath(star4(width * 0.1f, height * 0.04f, 16f * s), sparkle);
    }

    /** SVG `M x y q dx1 dy1 dx2 dy2`. */
    private static Path quad(float x, float y, float dx1, float dy1, float dx2, float dy2) {
        Path path = new Path();
        path.moveTo(x, y);
        path.rQuadTo(dx1, dy1, dx2, dy2);
        return path;
    }

    /** The composition's concave four-point sparkle. */
    private static Path star4(float cx, float cy, float r) {
        float i = r * 0.24f;
        Path path = new Path();
        path.moveTo(cx, cy - r);
        path.cubicTo(cx + i, cy - i, cx + i, cy - i, cx + r, cy);
        path.cubicTo(cx + i, cy + i, cx + i, cy + i, cx, cy + r);
        path.cubicTo(cx - i, cy + i, cx - i, cy + i, cx - r, cy);
        path.cubicTo(cx - i, cy - i, cx - i, cy - i, cx, cy - r);
        path.close();
        return path;
    }

    /**
     * `stroke-dasharray: dash; stroke-dashoffset: dash * (1 - draw)` — the
     * visible part of the path is its first `draw * dash` units.
     */
    private void drawOn(Path path, float dash, float draw, Paint paint) {
        if (draw <= 0f) return;
        PathMeasure measure = new PathMeasure(path, false);
        float length = measure.getLength();
        float visible = Math.min(length, draw * dash);
        if (visible >= length) {
            canvas.drawPath(path, paint);
            return;
        }
        Path partial = new Path();
        measure.getSegment(0f, visible, partial, true);
        canvas.drawPath(partial, paint);
    }

    // ── editorial ───────────────────────────────────────────────────────────

    private void drawEditorial(double t) {
        float draw = clamp01((float) ((t - 0.2d) / 1.3d));

        // Scrims: top 20 % from rgba(0,0,0,0.42), bottom 30 % from 0.55.
        Paint top = new Paint();
        top.setShader(new LinearGradient(0, 0, 0, height * 0.20f,
            Color.argb(107, 0, 0, 0), Color.TRANSPARENT, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height * 0.20f, top);
        Paint bottom = new Paint();
        bottom.setShader(new LinearGradient(0, height, 0, height * 0.70f,
            Color.argb(140, 0, 0, 0), Color.TRANSPARENT, Shader.TileMode.CLAMP));
        canvas.drawRect(0, height * 0.70f, width, height, bottom);

        // The hairline frame, drawn on around its perimeter.
        float inset = Math.round(Math.min(width, height) * 0.045f);
        float border = Math.max(2f, 2.4f * s);
        float rectWidth = width - inset * 2f;
        float rectHeight = height - inset * 2f;
        float perimeter = 2f * (rectWidth + rectHeight);
        Paint frame = new Paint(Paint.ANTI_ALIAS_FLAG);
        frame.setStyle(Paint.Style.STROKE);
        frame.setStrokeWidth(border);
        frame.setColor(withAlpha(template.neutral, 0.85f * draw));
        Path rect = new Path();
        rect.addRoundRect(new RectF(inset, inset, inset + rectWidth, inset + rectHeight),
            18f * s, 18f * s, Path.Direction.CW);
        drawOn(rect, perimeter, draw, frame);

        // The kicker: an accent dot and a short rule, top-left inside the frame.
        Paint accent = new Paint(Paint.ANTI_ALIAS_FLAG);
        accent.setColor(withAlpha(template.accent, draw));
        canvas.drawCircle(inset + 34f * s, inset + 42f * s, 6f * s, accent);
        canvas.drawRoundRect(
            new RectF(inset + 50f * s, inset + 39f * s, inset + 146f * s, inset + 44f * s),
            2.5f * s, 2.5f * s, accent);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static float clamp01(float value) {
        return MotionMath.clamp(value, 0f, 1f);
    }

    private static int withAlpha(int color, float alpha) {
        return Color.argb(
            Math.round(255 * clamp01(alpha)),
            Color.red(color), Color.green(color), Color.blue(color)
        );
    }
}
