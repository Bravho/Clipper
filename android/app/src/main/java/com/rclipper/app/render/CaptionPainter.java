package com.rclipper.app.render;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;

import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Draws the caption stack exactly as the server's styled render draws it.
 *
 * THE REFERENCE IS `Subtitles` IN `remotion/TemplatedVideo.tsx` — the component
 * every delivered video's captions come from. It is a bottom-anchored column of
 * rounded plates, one per language, in the requested order:
 *
 *   scale      min(width, height) / 1080 — the short side, so a 16:9 export
 *              gets captions the same size as a 9:16 one;
 *   fonts      Thai 62, English 52, Chinese 50 (reference px), weight 800;
 *   colours    Thai and English white, Chinese #FFE066;
 *   stroke     6 px black under the fill (`paint-order: stroke fill`);
 *   shadow     3 px 3 px 6 px rgba(0,0,0,0.9);
 *   plate      rgba(0,0,0,0.4), 18 px corners, 10 px x 26 px padding;
 *   stack      150 px off the bottom, 16 px between plates, 48 px side margin;
 *   appear     150 ms fade with a 0.96 → 1 scale from the stack's bottom centre.
 *
 * WRAPPING matches `wrapCaption`: a cue at or under its language's character
 * budget (Thai 26, English 30, Chinese 16) is one line; a longer one is split
 * into TWO lines balanced by length, on word boundaries — spaces for English,
 * a dictionary word break for Thai and Chinese (the browser uses
 * `Intl.Segmenter`; {@link BreakIterator} is the same ICU data on Android). A
 * balanced line that is still wider than the frame wraps again, as the span's
 * `max-width: 100%` makes it.
 */
public final class CaptionPainter {

    private static final float REFERENCE_SHORT_SIDE = 1080f;
    private static final float STACK_BOTTOM = 150f;
    private static final float LINE_GAP = 16f;
    private static final float SIDE_PADDING = 48f;
    private static final float LINE_HEIGHT = 1.22f;
    private static final float STROKE_WIDTH = 6f;
    // text-shadow lengths are plain CSS pixels in the composition (unscaled).
    private static final float SHADOW_DX = 3f;
    private static final float SHADOW_DY = 3f;
    private static final float SHADOW_BLUR = 6f;
    private static final float PLATE_RADIUS = 18f;
    private static final float PLATE_PADDING_Y = 10f;
    private static final float PLATE_PADDING_X = 26f;
    private static final float APPEAR_SECONDS = 0.15f;
    private static final float APPEAR_SCALE_FROM = 0.96f;
    private static final int PLATE_COLOR = Color.argb(102, 0, 0, 0);      // rgba(0,0,0,0.4)
    private static final int SHADOW_COLOR = Color.argb(230, 0, 0, 0);     // rgba(0,0,0,0.9)

    private final int width;
    private final int height;
    private final float scale;
    private final List<String> languages;
    private final List<RenderManifest.Caption> captions;

    /**
     * One reusable bitmap: a 1080x1920 ARGB frame is 8 MB, and allocating one
     * per frame at 30 fps is how a mid-range phone ends up throttled halfway
     * through an export. Media3 re-uploads it whenever its generation id moves.
     */
    private final Bitmap canvasBitmap;
    private final Canvas canvas;
    private final TextPaint strokePaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint platePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    /** Layout is per cue, not per frame: line breaking twice a frame is waste. */
    private RenderManifest.Caption laidOutFor;
    private List<LanguageLine> laidOut;

    public CaptionPainter(
        int width, int height, List<String> languages, List<RenderManifest.Caption> captions
    ) {
        this.width = width;
        this.height = height;
        this.scale = Math.min(width, height) / REFERENCE_SHORT_SIDE;
        this.languages = languages;
        this.captions = captions;
        this.canvasBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        this.canvas = new Canvas(canvasBitmap);
        this.platePaint.setColor(PLATE_COLOR);
    }

    public void release() {
        if (!canvasBitmap.isRecycled()) canvasBitmap.recycle();
    }

    /** The cue showing at `seconds`, or null. Matches the composition's `find`. */
    public RenderManifest.Caption activeCaption(double seconds) {
        for (RenderManifest.Caption caption : captions) {
            if (seconds >= caption.startSeconds && seconds <= caption.endSeconds) return caption;
        }
        return null;
    }

    public boolean hasCaptions() {
        return !captions.isEmpty() && !languages.isEmpty();
    }

    /**
     * Draw the caption stack for `seconds`, or return null when nothing is
     * showing so the caller hands Media3 its transparent frame instead.
     */
    public Bitmap draw(double seconds) {
        RenderManifest.Caption active = activeCaption(seconds);
        if (active == null) return null;

        if (active != laidOutFor) {
            laidOut = layoutLines(active);
            laidOutFor = active;
        }
        List<LanguageLine> lines = laidOut;
        if (lines.isEmpty()) return null;

        float appear = MotionMath.clamp(
            (float) ((seconds - active.startSeconds) / APPEAR_SECONDS), 0f, 1f);
        float popScale = APPEAR_SCALE_FROM + (1f - APPEAR_SCALE_FROM) * appear;

        canvasBitmap.eraseColor(Color.TRANSPARENT);

        float gap = LINE_GAP * scale;
        float stackHeight = 0f;
        for (int i = 0; i < lines.size(); i++) {
            stackHeight += lines.get(i).plateHeight;
            if (i > 0) stackHeight += gap;
        }

        float bottom = height - STACK_BOTTOM * scale;
        float top = bottom - stackHeight;

        canvas.save();
        canvas.scale(popScale, popScale, width / 2f, bottom);
        int alpha = Math.round(255 * appear);
        float y = top;
        for (LanguageLine line : lines) {
            drawLine(line, y, alpha);
            y += line.plateHeight + gap;
        }
        canvas.restore();

        return canvasBitmap;
    }

    // ── layout ──────────────────────────────────────────────────────────────

    private static final class LanguageLine {
        StaticLayout layout;
        int color;
        float plateWidth;
        float plateHeight;
    }

    private List<LanguageLine> layoutLines(RenderManifest.Caption caption) {
        List<LanguageLine> lines = new ArrayList<>();
        int maxTextWidth = Math.round(
            width - 2 * SIDE_PADDING * scale - 2 * PLATE_PADDING_X * scale);
        if (maxTextWidth <= 0) return lines;

        for (String language : languages) {
            String text = caption.textFor(language);
            if (text == null || text.trim().isEmpty()) continue;

            String wrapped = joinLines(wrapCaption(text, maxCharsFor(language)));

            TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
            paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            paint.setTextSize(fontSizeFor(language) * scale);
            paint.setColor(colorFor(language));

            StaticLayout layout = StaticLayout.Builder
                .obtain(wrapped, 0, wrapped.length(), paint, maxTextWidth)
                .setAlignment(Layout.Alignment.ALIGN_CENTER)
                .setLineSpacing(0f, LINE_HEIGHT)
                .setIncludePad(false)
                .build();

            LanguageLine line = new LanguageLine();
            line.layout = layout;
            line.color = colorFor(language);
            float widest = 0f;
            for (int i = 0; i < layout.getLineCount(); i++) {
                widest = Math.max(widest, layout.getLineWidth(i));
            }
            line.plateWidth = widest + 2 * PLATE_PADDING_X * scale;
            line.plateHeight = layout.getHeight() + 2 * PLATE_PADDING_Y * scale;
            lines.add(line);
        }
        return lines;
    }

    private static String joinLines(List<String> lines) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) out.append('\n');
            out.append(lines.get(i));
        }
        return out.toString();
    }

    /** `wrapCaption` from the composition. Package-private for tests. */
    static List<String> wrapCaption(String text, int maxChars) {
        String trimmed = text.trim();
        List<String> result = new ArrayList<>();
        if (trimmed.length() <= maxChars) {
            result.add(trimmed);
            return result;
        }
        if (trimmed.matches("(?s).*\\s.*")) {
            List<String> words = new ArrayList<>();
            for (String word : trimmed.split("\\s+")) if (!word.isEmpty()) words.add(word);
            return balanceTwoLines(words, " ");
        }
        return balanceTwoLines(segmentWords(trimmed), "");
    }

    /** Word units of a no-space script, on dictionary boundaries. */
    private static List<String> segmentWords(String text) {
        boolean thai = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= '฀' && c <= '๿') {
                thai = true;
                break;
            }
        }
        List<String> units = new ArrayList<>();
        try {
            BreakIterator iterator = BreakIterator.getWordInstance(
                thai ? new Locale("th") : Locale.SIMPLIFIED_CHINESE);
            iterator.setText(text);
            int start = iterator.first();
            for (int end = iterator.next(); end != BreakIterator.DONE; start = end, end = iterator.next()) {
                String unit = text.substring(start, end);
                if (!unit.isEmpty()) units.add(unit);
            }
        } catch (RuntimeException ignored) {
            units.clear();
        }
        if (units.isEmpty()) {
            for (int i = 0; i < text.length(); ) {
                int next = text.offsetByCodePoints(i, 1);
                units.add(text.substring(i, next));
                i = next;
            }
        }
        return units;
    }

    /** Split units into two lines balanced by character length. */
    private static List<String> balanceTwoLines(List<String> units, String joiner) {
        List<String> result = new ArrayList<>();
        if (units.size() < 2) {
            result.add(join(units, joiner));
            return result;
        }
        int total = joiner.length() * (units.size() - 1);
        for (String unit : units) total += unit.length();
        int target = (int) Math.ceil(total / 2d);
        int accumulated = 0;
        int best = 1;
        int bestDiff = Integer.MAX_VALUE;
        for (int i = 0; i < units.size() - 1; i++) {
            accumulated += units.get(i).length() + joiner.length();
            int diff = Math.abs(accumulated - target);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = i + 1;
            }
        }
        result.add(join(units.subList(0, best), joiner));
        result.add(join(units.subList(best, units.size()), joiner));
        return result;
    }

    /** The JDK's String join needs API 26; this app still supports 24. */
    private static String join(List<String> parts, String joiner) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) out.append(joiner);
            out.append(parts.get(i));
        }
        return out.toString();
    }

    // ── drawing ─────────────────────────────────────────────────────────────

    private void drawLine(LanguageLine line, float top, int alpha) {
        float plateLeft = (width - line.plateWidth) / 2f;
        platePaint.setAlpha(Math.round(Color.alpha(PLATE_COLOR) * (alpha / 255f)));
        canvas.drawRoundRect(
            new RectF(plateLeft, top, plateLeft + line.plateWidth, top + line.plateHeight),
            PLATE_RADIUS * scale, PLATE_RADIUS * scale, platePaint
        );

        float textLeft = (width - line.layout.getWidth()) / 2f;
        float textTop = top + PLATE_PADDING_Y * scale;
        TextPaint layoutPaint = line.layout.getPaint();

        // Pass 1 — the black outline with the drop shadow, under the fill.
        strokePaint.set(layoutPaint);
        layoutPaint.setStyle(Paint.Style.STROKE);
        layoutPaint.setStrokeWidth(STROKE_WIDTH * scale);
        layoutPaint.setColor(Color.BLACK);
        layoutPaint.setAlpha(alpha);
        layoutPaint.setShadowLayer(SHADOW_BLUR, SHADOW_DX, SHADOW_DY,
            Color.argb(Math.round(Color.alpha(SHADOW_COLOR) * (alpha / 255f)), 0, 0, 0));
        drawLayout(line.layout, textLeft, textTop);

        // Pass 2 — the fill.
        layoutPaint.clearShadowLayer();
        layoutPaint.setStyle(Paint.Style.FILL);
        layoutPaint.setStrokeWidth(0f);
        layoutPaint.setColor(line.color);
        layoutPaint.setAlpha(alpha);
        drawLayout(line.layout, textLeft, textTop);

        // Leave the layout's paint as it was built.
        layoutPaint.set(strokePaint);
    }

    private void drawLayout(StaticLayout layout, float left, float top) {
        canvas.save();
        canvas.translate(left, top);
        layout.draw(canvas);
        canvas.restore();
    }

    /** `LANG_STYLE` font sizes, at the 1080 short-side reference. */
    private static float fontSizeFor(String language) {
        switch (language) {
            case "th": return 62f;
            case "en": return 52f;
            case "zh": return 50f;
            default: return 52f;
        }
    }

    /** `LANG_STYLE` character budgets before a cue is split into two lines. */
    private static int maxCharsFor(String language) {
        switch (language) {
            case "th": return 26;
            case "en": return 30;
            case "zh": return 16;
            default: return 30;
        }
    }

    /** Thai and English are white; Chinese is #FFE066. */
    private static int colorFor(String language) {
        return "zh".equals(language) ? Color.rgb(0xFF, 0xE0, 0x66) : Color.WHITE;
    }
}
