package com.rclipper.app.render;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.RectF;
import android.graphics.Typeface;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Draws the scene-matched text graphics: the hook, the scene labels with their
 * badges, and the closing call-to-action card — in the pack's frame (card,
 * none, post-it, painting, ribbon, bubble), text effect (plain, shadow,
 * outline, glow) and position.
 *
 * THE REFERENCE IS `src/lib/textGraphics/` — `layout.ts` for every box and
 * position, `motion.ts` for every curve, `canvasRenderer.ts` for every paint.
 * That is the studio preview the requester chose from, so this must draw the
 * same thing. All lengths are reference px at a 1080 short side times `s`.
 *
 * Like {@link CaptionPainter} it owns ONE frame-sized bitmap and redraws it in
 * place; a frame with no item on screen returns null (the overlay hands Media3
 * its transparent bitmap instead).
 */
public final class TextGraphicsPainter {

    private static final float MARGIN_X = 64f;

    // ── Layout tree ─────────────────────────────────────────────────────────

    static final int PAINT_NONE = 0;
    static final int PAINT_BOX = 1;
    static final int PAINT_TEXT = 2;
    static final int PAINT_DOT = 3;
    static final int PAINT_PIN = 4;
    static final int PAINT_BADGE = 5;
    static final int PAINT_PANEL = 6;

    static final class Node {
        float x, y, w, h;
        /** 'l' left-centre, 'c' centre, 't' top-centre. */
        char anchor = 'l';
        TextGraphics.Anim anim;
        TextGraphics.Idle idle;
        float rotate;
        int paintType = PAINT_NONE;
        int color;
        float radius;
        float shadowDx, shadowDy;
        int shadowColor;
        String text = "";
        String fontKey = "";
        float size;
        float ascent, descent;
        String shape = "circle";
        int bg, ring;
        // Panel.
        String frame = "card";
        int frameColor, frameInner, frameAccent, frameMat, tape;
        float frameWidth;
        // Text effect.
        String effect = "plain";
        int effectColor;
        float effectBlur, effectDy, effectWidth;
        final List<Node> children = new ArrayList<>();
    }

    static final class ItemLayout {
        TextGraphics.Item item;
        float pivotX, pivotY;
        final List<Node> nodes = new ArrayList<>();
    }

    private final TextGraphics spec;
    private final int width;
    private final int height;
    private final float s;
    private final Map<String, Typeface> typefaces = new HashMap<>();
    private final Typeface fallbackFace = Typeface.create(Typeface.DEFAULT, Typeface.BOLD);
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint measurePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final List<ItemLayout> layouts = new ArrayList<>();
    private final RectF rect = new RectF();
    private final Path path = new Path();

    private Bitmap bitmap;
    private Canvas canvas;

    /**
     * @param fontFiles font key → downloaded TTF; a missing or unreadable file
     *                  falls back to the system bold face.
     */
    public TextGraphicsPainter(TextGraphics spec, Map<String, File> fontFiles, int width, int height) {
        this.spec = spec;
        this.width = width;
        this.height = height;
        this.s = Math.min(width, height) / 1080f;
        if (fontFiles != null) {
            for (Map.Entry<String, File> entry : fontFiles.entrySet()) {
                try {
                    if (entry.getValue() != null && entry.getValue().isFile()) {
                        typefaces.put(entry.getKey(), Typeface.createFromFile(entry.getValue()));
                    }
                } catch (RuntimeException ignored) {
                    // Fall back to the system face for this key.
                }
            }
        }
        if (spec != null) {
            for (TextGraphics.Item item : spec.items) {
                ItemLayout layout = layoutItem(item);
                if (layout != null) layouts.add(layout);
            }
        }
    }

    public boolean isEmpty() {
        return layouts.isEmpty();
    }

    public void release() {
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        bitmap = null;
        canvas = null;
    }

    /** The frame at `seconds`, or null when nothing is on screen. */
    public Bitmap draw(double seconds) {
        boolean any = false;
        for (ItemLayout layout : layouts) {
            if (seconds >= layout.item.start && seconds <= layout.item.end) {
                any = true;
                break;
            }
        }
        if (!any) return null;
        if (bitmap == null) {
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            canvas = new Canvas(bitmap);
        }
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
        for (ItemLayout layout : layouts) {
            if (seconds < layout.item.start || seconds > layout.item.end) continue;
            drawItem(layout, seconds);
        }
        return bitmap;
    }

    // ── Text measurement ────────────────────────────────────────────────────

    private Typeface face(String key) {
        Typeface face = typefaces.get(key);
        return face != null ? face : fallbackFace;
    }

    private float measure(String text, String fontKey, float size) {
        measurePaint.setTypeface(face(fontKey));
        measurePaint.setTextSize(size);
        return measurePaint.measureText(text);
    }

    private float ascentOf(String key) {
        TextGraphics.Font font = spec.font(key);
        return font != null ? font.ascent : 1.0f;
    }

    private float descentOf(String key) {
        TextGraphics.Font font = spec.font(key);
        return font != null ? font.descent : 0.3f;
    }

    private float lineHeight(String key, float size) {
        return size * (ascentOf(key) + descentOf(key));
    }

    private float fitSize(String text, String font, float size, float maxWidth, float minFactor) {
        float w = measure(text, font, size);
        if (w <= maxWidth || w <= 0) return size;
        return Math.max(size * minFactor, size * maxWidth / w);
    }

    private float safeTop() {
        return (float) height / width >= 1.5f
            ? 0.11f * height
            : Math.max(56f * s, 0.06f * height);
    }

    /** `textEffectFor` in layout.ts. */
    private void applyEffect(Node n, float size) {
        n.effect = spec.textEffect;
        n.effectColor = spec.color("textEffect");
        switch (spec.textEffect) {
            case "shadow": n.effectBlur = 12 * s; n.effectDy = 3 * s; break;
            case "outline": n.effectWidth = Math.max(3 * s, size * 0.12f); break;
            case "glow": n.effectBlur = size * 0.45f; break;
            case "marker":
                // Highlighter behind big words; small words get a soft dark shadow.
                if (size >= 40 * s) {
                    n.effectBlur = 8 * s; n.effectDy = 2 * s; n.effectWidth = 10 * s;
                } else {
                    n.effect = "shadow";
                    n.effectColor = 0xB0000000;
                    n.effectBlur = 8 * s; n.effectDy = 2 * s;
                }
                break;
            default: n.effect = "plain"; break;
        }
    }

    private Node textNode(String text, String font, float size, int color, float x, float y,
                          TextGraphics.Anim anim, boolean withEffect) {
        Node n = new Node();
        n.x = x;
        n.y = y;
        n.w = measure(text, font, size);
        n.h = lineHeight(font, size);
        n.anim = anim;
        n.paintType = PAINT_TEXT;
        n.text = text;
        n.fontKey = font;
        n.size = size;
        n.color = color;
        n.ascent = ascentOf(font);
        n.descent = descentOf(font);
        if (withEffect) applyEffect(n, size);
        return n;
    }

    private Node boxNode(float x, float y, float w, float h, int color, float radius,
                         TextGraphics.Anim anim) {
        Node n = new Node();
        n.x = x;
        n.y = y;
        n.w = w;
        n.h = h;
        n.anim = anim;
        n.paintType = PAINT_BOX;
        n.color = color;
        n.radius = radius;
        return n;
    }

    /** `panelPaint` in layout.ts. */
    private Node panelNode(float x, float y, float w, float h, String colorName, TextGraphics.Anim anim) {
        Node n = boxNode(x, y, w, h, spec.color(colorName), spec.cardRadius * s, anim);
        n.paintType = PAINT_PANEL;
        n.frame = spec.frame;
        n.shadowDx = spec.shadowDx * s;
        n.shadowDy = spec.shadowDy * s;
        n.shadowColor = spec.color("shadow");
        n.frameColor = spec.color("frame");
        n.frameInner = spec.color("frameInner");
        n.frameAccent = spec.color("frameAccent");
        n.frameMat = spec.color("frameMat");
        n.tape = spec.color("tape");
        n.frameWidth = spec.frameWidth * s;
        return n;
    }

    /** `basePadding` in layout.ts: [left, right, top, bottom]. */
    private float[] padding(float l, float r, float t, float b) {
        if ("none".equals(spec.frame)) return new float[] { 0, 0, 0, 0 };
        float fw = spec.frameWidth * s;
        float fl = 0, fr = 0, ft = 0, fb = 0;
        switch (spec.frame) {
            case "painting": fl = fw + 12 * s; fr = fl; ft = fl; fb = fl; break;
            case "ribbon":
            case "slant": fl = fw; fr = fw; break;
            case "postit": fl = 6 * s; fr = 6 * s; ft = 18 * s; fb = 6 * s; break;
            default: break;
        }
        return new float[] { l * s + fl, r * s + fr, t * s + ft, b * s + fb };
    }

    private String fontRole(String role) {
        String key = spec.fonts.get(role);
        return key != null ? key : "";
    }

    // ── Layout (layout.ts) ──────────────────────────────────────────────────

    private ItemLayout layoutItem(TextGraphics.Item item) {
        List<Node> nodes;
        switch (item.kind) {
            case "hook": nodes = layoutHook(item); break;
            case "cta": nodes = layoutCta(item); break;
            case "label": nodes = layoutLabel(item); break;
            default: return null;
        }
        String position = isPosition(item.position) ? item.position : spec.positions.get(item.kind);
        if (!isPosition(position)) position = "top-left";
        // A hung painting's wire and nail rise 44 px above the frame: keep them on screen.
        float wireTop = "painting".equals(spec.frame) && !"cta".equals(item.kind) ? 50 * s : 0;
        return place(item, nodes, position, wireTop);
    }

    private static boolean isPosition(String value) {
        if (value == null) return false;
        switch (value) {
            case "top-left": case "top-center": case "top-right":
            case "middle-left": case "middle-right":
                return true;
            default:
                return false;
        }
    }

    private static void shift(Node n, float dx, float dy) {
        n.x += dx;
        n.y += dy;
        for (Node child : n.children) shift(child, dx, dy);
    }

    /** `place` in layout.ts. */
    private ItemLayout place(TextGraphics.Item item, List<Node> nodes, String position, float extraTop) {
        float x0 = Float.MAX_VALUE, y0 = Float.MAX_VALUE, x1 = -Float.MAX_VALUE, y1 = -Float.MAX_VALUE;
        for (Node n : nodes) {
            x0 = Math.min(x0, n.x);
            y0 = Math.min(y0, n.y);
            x1 = Math.max(x1, n.x + n.w);
            y1 = Math.max(y1, n.y + n.h);
        }
        float bw = x1 - x0;
        float bh = y1 - y0;
        float M = MARGIN_X * s;
        float top = safeTop() + extraTop;
        String row = position.startsWith("top") ? "top" : "middle";
        String col = position.endsWith("left") ? "left" : position.endsWith("right") ? "right" : "center";
        float x = col.equals("left") ? M : col.equals("right") ? width - M - bw : (width - bw) / 2;
        float y = row.equals("top") ? top : Math.max(top, 0.42f * height - bh / 2);
        for (Node n : nodes) shift(n, x - x0, y - y0);
        boolean centred = col.equals("center") || "cta".equals(item.kind);

        ItemLayout layout = new ItemLayout();
        layout.item = item;
        layout.pivotX = centred ? x + bw / 2 : col.equals("right") ? x + bw : x;
        layout.pivotY = centred ? y + bh / 2 : y;
        layout.nodes.addAll(nodes);
        return layout;
    }

    private List<Node> layoutLabel(TextGraphics.Item item) {
        float M = MARGIN_X * s;
        float top = safeTop();
        boolean hasBadge = !item.badge.isEmpty();
        float D = spec.size("badgeDiameter", 150) * s;
        float barW = spec.barWidth * s;
        float barGap = barW > 0 ? 14 * s : 0;
        float[] pad = padding(26, 30, 16, 20);
        float padL = pad[0], padR = pad[1], padT = pad[2], padB = pad[3];

        float maxText = width - 2 * M - barW - barGap - padL - padR - (hasBadge ? 0.9f * D : 0);
        String titleFont = fontRole("title");
        String bodyFont = fontRole("body");
        float titleSize = fitSize(item.title, titleFont, spec.size("title", 60) * s, maxText, 0.6f);
        String sub = spec.uppercaseSub ? item.sub.toUpperCase(Locale.ROOT) : item.sub;
        float subSize = fitSize(sub, bodyFont, spec.size("sub", 28) * s, maxText, 0.6f);
        float numSize = spec.size("num", 28) * s;

        float cardX = M + barW + barGap;
        float innerX = cardX + padL;
        float y = top + padT;
        List<Node> children = new ArrayList<>();

        if (!item.num.isEmpty()) {
            Node n = textNode(item.num, titleFont, numSize, spec.color("num"), innerX, y, spec.anim("num"), true);
            children.add(n);
            y += n.h + 2 * s;
        }
        Node title = textNode(item.title, titleFont, titleSize, spec.color("title"), innerX, y, spec.anim("title"), true);
        children.add(title);
        y += title.h;
        if (spec.underline) {
            y += 4 * s;
            children.add(boxNode(innerX, y, title.w, 6 * s, spec.color("underline"), 3 * s, spec.anim("underline")));
            y += 6 * s + 8 * s;
        } else {
            y += 4 * s;
        }
        if (!sub.isEmpty()) {
            Node subNode = textNode(sub, bodyFont, subSize, spec.color("sub"), innerX, y, spec.anim("sub"), true);
            children.add(subNode);
            y += subNode.h;
        }
        float contentW = 0;
        for (Node child : children) contentW = Math.max(contentW, child.w);
        float cardW = padL + contentW + padR;
        float cardH = y + padB - top;

        List<Node> nodes = new ArrayList<>();
        if (barW > 0) {
            Node bar = boxNode(M, top, barW, cardH, spec.color("bar"), barW / 2, spec.anim("bar"));
            bar.anchor = 't';
            nodes.add(bar);
        }
        Node card = panelNode(cardX, top, cardW, cardH, "cardBg", spec.anim("card"));
        card.children.addAll(children);
        nodes.add(card);

        if (hasBadge) {
            String badgeFont = fontRole("badge");
            boolean tag = "tag".equals(spec.badgeShape);
            float bw = tag ? 1.4f * D : D;
            float bh = tag ? 0.6f * D : D;
            float overlap = "none".equals(spec.frame) ? -16 * s : 0.1f * bh;
            float cx = cardX + cardW + bw / 2 - overlap;
            float cy = top + 0.22f * D;
            float textMax = (tag ? 1.15f : 0.66f) * D;
            Node badge = new Node();
            badge.x = cx - bw / 2;
            badge.y = cy - bh / 2;
            badge.w = bw;
            badge.h = bh;
            badge.anchor = 'c';
            badge.anim = spec.anim("badge");
            badge.idle = spec.badgeIdle;
            badge.rotate = spec.badgeRotate;
            badge.paintType = PAINT_BADGE;
            badge.shape = spec.badgeShape;
            badge.bg = spec.color("badgeBg");
            badge.ring = spec.color("badgeRing");
            badge.text = item.badge;
            badge.fontKey = badgeFont;
            badge.size = fitSize(item.badge, badgeFont, spec.size("badgeText", 32) * s, textMax, 0.5f);
            badge.color = spec.color("badgeText");
            badge.ascent = ascentOf(badgeFont);
            badge.descent = descentOf(badgeFont);
            nodes.add(badge);
        }
        return nodes;
    }

    private List<Node> layoutHook(TextGraphics.Item item) {
        float M = MARGIN_X * s;
        float top = safeTop();
        float[] pad = padding(22, 30, 16, 20);
        float padL = pad[0], padR = pad[1], padT = pad[2], padB = pad[3];
        float dotD = spec.hookDot ? 44 * s : 0;
        float dotGap = spec.hookDot ? 18 * s : 0;
        String font = fontRole("hook");
        String bodyFont = fontRole("body");
        float maxText = width - 2 * M - padL - padR;

        float innerX = M + padL;
        float y = top + padT;
        List<Node> children = new ArrayList<>();

        if (!item.kicker.isEmpty()) {
            String kickerText = item.kicker.toUpperCase(Locale.ROOT);
            float size = fitSize(kickerText, bodyFont, spec.size("kicker", 24) * s, maxText - 28 * s, 0.6f);
            Node label = textNode(kickerText, bodyFont, size, spec.color("kickerText"), innerX + 14 * s, y + 6 * s, null, false);
            Node chip = boxNode(innerX, y, label.w + 28 * s, label.h + 12 * s, spec.color("kickerBg"), 6 * s, spec.anim("kicker"));
            chip.children.add(label);
            children.add(chip);
            y += chip.h + 10 * s;
        }

        float titleSize = fitSize(item.title, font, spec.size("hookTitle", 70) * s, maxText - dotD - dotGap, 0.6f);
        float titleH = lineHeight(font, titleSize);
        float rowH = Math.max(dotD, titleH);
        if (dotD > 0) {
            Node dot = new Node();
            dot.x = innerX;
            dot.y = y + (rowH - dotD) / 2;
            dot.w = dotD;
            dot.h = dotD;
            dot.anchor = 'c';
            dot.anim = spec.anim("dot");
            dot.paintType = PAINT_DOT;
            dot.color = spec.color("dot");
            children.add(dot);
        }
        children.add(textNode(item.title, font, titleSize, spec.color("hookTitle"),
            innerX + dotD + dotGap, y + (rowH - titleH) / 2, spec.anim("hookTitle"), true));
        y += rowH + 4 * s;

        if (!item.sub.isEmpty()) {
            float size = fitSize(item.sub, bodyFont, spec.size("hookSub", 34) * s, maxText, 0.6f);
            Node sub = textNode(item.sub, bodyFont, size, spec.color("hookSub"), innerX, y, spec.anim("hookSub"), true);
            children.add(sub);
            y += sub.h;
        }

        float contentRight = innerX;
        for (Node child : children) contentRight = Math.max(contentRight, child.x + child.w);
        float boxW = contentRight - M + padR;
        float boxH = y + padB - top;
        Node box = panelNode(M, top, boxW, boxH, "hookBg", spec.anim("hookBox"));
        box.children.addAll(children);
        List<Node> nodes = new ArrayList<>();
        nodes.add(box);
        return nodes;
    }

    private List<Node> layoutCta(TextGraphics.Item item) {
        List<Node> first = layoutCtaAt(item, 1f);
        float maxW = width - 2 * MARGIN_X * s;
        float w = first.get(0).w;
        if (w <= maxW) return first;
        return layoutCtaAt(item, Math.max(0.55f, maxW / w));
    }

    private List<Node> layoutCtaAt(TextGraphics.Item item, float f) {
        float k = s * f;
        float top = safeTop();
        float padX = 22 * k, padY = 18 * k, pinSize = 72 * k, gap1 = 20 * k, gap2 = 26 * k;
        String titleFont = fontRole("title");
        String bodyFont = fontRole("body");

        float brandSize = spec.size("ctaBrand", 46) * k;
        float placeSize = spec.size("ctaPlace", 30) * k;
        float buttonSize = spec.size("ctaButton", 42) * k;
        boolean hasBrand = !item.brand.isEmpty();
        boolean hasPlace = !item.place.isEmpty();
        boolean hasButton = !item.title.isEmpty();
        float brandW = hasBrand ? measure(item.brand, titleFont, brandSize) : 0;
        float placeW = hasPlace ? measure(item.place, bodyFont, placeSize) : 0;
        float brandH = hasBrand ? lineHeight(titleFont, brandSize) : 0;
        float placeH = hasPlace ? lineHeight(bodyFont, placeSize) : 0;
        float colW = Math.max(brandW, placeW);
        float colH = brandH + placeH;
        float buttonTextW = hasButton ? measure(item.title, titleFont, buttonSize) : 0;
        float buttonH = hasButton ? lineHeight(titleFont, buttonSize) + 24 * k : 0;
        float buttonW = hasButton ? buttonTextW + 60 * k : 0;

        float innerH = Math.max(pinSize, Math.max(colH, buttonH));
        float contentW = pinSize + (colW > 0 ? gap1 + colW : 0) + (buttonW > 0 ? gap2 + buttonW : 0);
        float cardW = padX * 2 + contentW;
        float cardH = padY * 2 + innerH;
        float cardX = MARGIN_X * s;
        float cardY = top;
        float midY = cardY + padY + innerH / 2;

        List<Node> children = new ArrayList<>();
        float x = cardX + padX;
        Node pin = new Node();
        pin.x = x;
        pin.y = midY - pinSize / 2;
        pin.w = pinSize;
        pin.h = pinSize;
        pin.anchor = 'c';
        pin.anim = spec.anim("pin");
        pin.paintType = PAINT_PIN;
        pin.color = spec.color("pin");
        children.add(pin);
        x += pinSize;
        if (colW > 0) {
            x += gap1;
            float y = midY - colH / 2;
            if (hasBrand) {
                children.add(textNode(item.brand, titleFont, brandSize, spec.color("ctaBrand"), x, y, spec.anim("ctaText"), false));
                y += brandH;
            }
            if (hasPlace) {
                children.add(textNode(item.place, bodyFont, placeSize, spec.color("ctaPlace"), x, y, spec.anim("ctaText"), false));
            }
            x += colW;
        }
        if (buttonW > 0) {
            x += gap2;
            Node label = textNode(item.title, titleFont, buttonSize, spec.color("buttonText"),
                x + 30 * k, midY - buttonH / 2 + 12 * k, null, false);
            Node button = boxNode(x, midY - buttonH / 2, buttonW, buttonH, spec.color("buttonBg"), buttonH / 2, spec.anim("button"));
            button.anchor = 'c';
            button.idle = spec.buttonIdle;
            button.children.add(label);
            children.add(button);
        }

        Node card = boxNode(cardX, cardY, cardW, cardH, spec.color("ctaBg"), spec.ctaRadius * k, spec.anim("ctaCard"));
        card.anchor = 'c';
        card.shadowDx = spec.shadowDx * k;
        card.shadowDy = spec.shadowDy * k;
        card.shadowColor = spec.color("shadow");
        card.children.addAll(children);
        List<Node> nodes = new ArrayList<>();
        nodes.add(card);
        return nodes;
    }

    // ── Motion (motion.ts) ──────────────────────────────────────────────────

    static float clamp01(double x) {
        return (float) Math.min(1, Math.max(0, x));
    }

    static float easeOutCubic(float x) {
        return 1 - (float) Math.pow(1 - x, 3);
    }

    static float easeInCubic(float x) {
        return x * x * x;
    }

    static float easeBack(float x) {
        float c1 = 1.9f;
        float c3 = c1 + 1;
        return 1 + c3 * (float) Math.pow(x - 1, 3) + c1 * (float) Math.pow(x - 1, 2);
    }

    static float progress(TextGraphics.Anim anim, double lt) {
        if (anim.dur <= 0) return lt >= anim.delay ? 1 : 0;
        return clamp01((lt - anim.delay) / anim.dur);
    }

    static float ease(TextGraphics.Anim anim, float p) {
        return "pop".equals(anim.kind) || "drop".equals(anim.kind) ? easeBack(p) : easeOutCubic(p);
    }

    static double idleStart(TextGraphics.Anim anim) {
        return Math.max(1.0, anim != null ? anim.delay + anim.dur : 0);
    }

    // ── Drawing (canvasRenderer.ts) ─────────────────────────────────────────

    private void drawItem(ItemLayout layout, double t) {
        double lt = t - layout.item.start;
        double o = spec.exitDur > 0
            ? clamp01((t - (layout.item.end - spec.exitDur)) / spec.exitDur)
            : (t >= layout.item.end ? 1 : 0);
        float eo = easeInCubic((float) o);
        float translateX = 0;
        float scale = 1;
        float alpha;
        switch (spec.exitKind) {
            case "slideLeft":
                translateX = -40 * eo;
                alpha = 1 - eo;
                break;
            case "shrink":
                scale = 1 - 0.15f * eo;
                alpha = 1 - eo;
                break;
            default:
                alpha = 1 - (float) o;
                break;
        }
        float px = layout.pivotX;
        float py = layout.pivotY;

        int save = canvas.save();
        canvas.translate(translateX * s, 0);
        canvas.translate(px, py);
        if (scale != 1) canvas.scale(scale, scale);
        if (spec.tiltDeg != 0) canvas.rotate(spec.tiltDeg);
        canvas.translate(-px, -py);
        for (Node node : layout.nodes) drawNode(node, lt, alpha);
        canvas.restoreToCount(save);
    }

    private void drawNode(Node n, double lt, float alpha) {
        float translateY = 0, riseFraction = 0, scaleX = 1, scaleY = 1, a = 1, clipRight = 1;
        boolean clipToSelf = false;
        if (n.anim != null) {
            float p = progress(n.anim, lt);
            if (p <= 0) return;
            float e = ease(n.anim, p);
            switch (n.anim.kind) {
                case "rise": riseFraction = (1 - e) * 1.15f; clipToSelf = true; break;
                case "wipe": clipRight = e; break;
                case "pop": scaleX = e; scaleY = e; a = Math.min(1, p * 4); break;
                case "fade": a = e; translateY = (1 - e) * 16; break;
                case "growX": scaleX = e; break;
                case "growY": scaleY = e; break;
                case "drop": translateY = -(1 - e) * 40; a = Math.min(1, p * 4); break;
                default: break;
            }
        }
        float alphaHere = alpha * a;
        int save = canvas.save();
        if (translateY != 0) canvas.translate(0, translateY * s);
        if (scaleX != 1 || scaleY != 1) {
            float ax = n.anchor == 'l' ? n.x : n.x + n.w / 2;
            float ay = n.anchor == 't' ? n.y : n.y + n.h / 2;
            canvas.translate(ax, ay);
            canvas.scale(Math.max(0.0001f, scaleX), Math.max(0.0001f, scaleY));
            canvas.translate(-ax, -ay);
        }
        if (clipRight < 1) {
            canvas.clipRect(n.x - 60 * s, n.y - 600 * s,
                n.x + (n.w + 20 * s) * clipRight, n.y + n.h + 600 * s);
        }
        if (clipToSelf) {
            canvas.clipRect(n.x - 6 * s, n.y - 2 * s, n.x + n.w + 6 * s, n.y + n.h + 2 * s);
            canvas.translate(0, riseFraction * n.h);
        }

        float idleRotate = 0, idleTranslate = 0, idleScale = 1;
        TextGraphics.Idle idle = n.idle;
        if (idle != null && !"none".equals(idle.kind) && idle.period > 0) {
            double tau = lt - idleStart(n.anim);
            if (tau > 0) {
                float wave = (float) Math.sin(2 * Math.PI * tau / idle.period);
                switch (idle.kind) {
                    case "wobble": idleRotate = (float) idle.amp * wave; break;
                    case "float": idleTranslate = (float) idle.amp * wave; break;
                    case "pulse": idleScale = 1 + (float) idle.amp * wave; break;
                    default: break;
                }
            }
        }
        float cx = n.x + n.w / 2;
        float cy = n.y + n.h / 2;
        if (idleTranslate != 0) canvas.translate(0, idleTranslate * s);
        if (idleRotate != 0 || idleScale != 1 || n.rotate != 0) {
            canvas.translate(cx, cy);
            canvas.rotate(idleRotate + n.rotate);
            canvas.scale(idleScale, idleScale);
            canvas.translate(-cx, -cy);
        }

        paintNode(n, alphaHere);
        for (Node child : n.children) drawNode(child, lt, alphaHere);
        canvas.restoreToCount(save);
    }

    private void fillWith(int color, float alpha) {
        paint.reset();
        paint.setAntiAlias(true);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(color);
        paint.setAlpha(Math.round(Color.alpha(color) * Math.max(0, Math.min(1, alpha))));
    }

    private void strokeWith(int color, float alpha, float width) {
        fillWith(color, alpha);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(width);
    }

    private void roundRect(float x, float y, float w, float h, float r) {
        rect.set(x, y, x + w, y + h);
        float rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        canvas.drawRoundRect(rect, rr, rr, paint);
    }

    private void paintNode(Node n, float alpha) {
        switch (n.paintType) {
            case PAINT_BOX: {
                if ((n.shadowDx != 0 || n.shadowDy != 0) && Color.alpha(n.shadowColor) > 0) {
                    fillWith(n.shadowColor, alpha);
                    roundRect(n.x + n.shadowDx, n.y + n.shadowDy, n.w, n.h, n.radius);
                }
                fillWith(n.color, alpha);
                roundRect(n.x, n.y, n.w, n.h, n.radius);
                break;
            }
            case PAINT_PANEL:
                paintPanel(n, alpha);
                break;
            case PAINT_TEXT:
                paintText(n, alpha);
                break;
            case PAINT_DOT: {
                float cx = n.x + n.w / 2, cy = n.y + n.h / 2, r = n.w / 2;
                fillWith(Color.WHITE, alpha);
                canvas.drawCircle(cx, cy, r, paint);
                fillWith(n.color, alpha);
                canvas.drawCircle(cx, cy, r * 0.72f, paint);
                fillWith(Color.WHITE, alpha);
                canvas.drawCircle(cx, cy, r * 0.3f, paint);
                break;
            }
            case PAINT_PIN: {
                float k = n.w / 24f;
                fillWith(n.color, alpha);
                canvas.drawCircle(n.x + 12 * k, n.y + 9 * k, 7 * k, paint);
                path.reset();
                path.moveTo(n.x + 5.6f * k, n.y + 11.8f * k);
                path.lineTo(n.x + 18.4f * k, n.y + 11.8f * k);
                path.lineTo(n.x + 12 * k, n.y + 22 * k);
                path.close();
                canvas.drawPath(path, paint);
                fillWith(Color.WHITE, alpha);
                canvas.drawCircle(n.x + 12 * k, n.y + 9 * k, 2.8f * k, paint);
                break;
            }
            case PAINT_BADGE:
                paintBadge(n, alpha);
                break;
            default:
                break;
        }
    }

    /** `panelPath` in canvasRenderer.ts, as a Path. */
    private void panelPath(Node n, float x, float y) {
        path.reset();
        float w = n.w, h = n.h;
        if ("slant".equals(n.frame)) {
            float k = n.frameWidth;
            path.moveTo(x + k, y);
            path.lineTo(x + w, y);
            path.lineTo(x + w - k, y + h);
            path.lineTo(x, y + h);
            path.close();
            return;
        }
        if ("ribbon".equals(n.frame)) {
            float notch = n.frameWidth;
            path.moveTo(x, y);
            path.lineTo(x + w, y);
            path.lineTo(x + w - notch, y + h / 2);
            path.lineTo(x + w, y + h);
            path.lineTo(x, y + h);
            path.lineTo(x + notch, y + h / 2);
            path.close();
            return;
        }
        float r = Math.max(0, Math.min(n.radius, Math.min(w, h) / 2));
        path.addRoundRect(new RectF(x, y, x + w, y + h), r, r, Path.Direction.CW);
        if ("bubble".equals(n.frame)) {
            Path tail = new Path();
            tail.moveTo(x + 0.16f * w, y + h - 1);
            tail.lineTo(x + 0.16f * w + 40 * s, y + h - 1);
            tail.lineTo(x + 0.1f * w, y + h + 30 * s);
            tail.close();
            path.op(tail, Path.Op.UNION);
        }
    }

    /** `paintPanel` in canvasRenderer.ts. */
    private void paintPanel(Node n, float alpha) {
        if ("none".equals(n.frame)) return;
        if ((n.shadowDx != 0 || n.shadowDy != 0) && Color.alpha(n.shadowColor) > 0) {
            panelPath(n, n.x + n.shadowDx, n.y + n.shadowDy);
            fillWith(n.shadowColor, alpha);
            canvas.drawPath(path, paint);
        }
        if ("painting".equals(n.frame)) {
            paintPainting(n, alpha);
            return;
        }
        panelPath(n, n.x, n.y);
        fillWith(n.color, alpha);
        canvas.drawPath(path, paint);
        if ("postit".equals(n.frame)) {
            fillWith(0x12000000, alpha);
            canvas.drawRect(n.x, n.y + n.h - 10 * s, n.x + n.w, n.y + n.h, paint);
            float tw = Math.min(0.42f * n.w, 150 * s);
            float th = 34 * s;
            int save = canvas.save();
            canvas.translate(n.x + n.w / 2, n.y + 2 * s);
            canvas.rotate(-5);
            fillWith(n.tape, alpha);
            canvas.drawRect(-tw / 2, -th / 2, tw / 2, th / 2, paint);
            canvas.restoreToCount(save);
        }
    }

    private void fillRectIn(Node n, float inset, int color, float alpha) {
        fillWith(color, alpha);
        canvas.drawRect(n.x + inset, n.y + inset, n.x + n.w - inset, n.y + n.h - inset, paint);
    }

    private void strokeRectIn(Node n, float inset, int color, float width, float alpha) {
        strokeWith(color, alpha, width);
        canvas.drawRect(n.x + inset, n.y + inset, n.x + n.w - inset, n.y + n.h - inset, paint);
    }

    /** `paintPainting` in canvasRenderer.ts: a painting hung on the wall. */
    private void paintPainting(Node n, float alpha) {
        float fw = n.frameWidth;
        float x = n.x, y = n.y, w = n.w, h = n.h;

        // The wire and the nail, behind the frame.
        float nailX = x + w / 2;
        float nailY = y - 44 * s;
        strokeWith(n.frameInner, alpha, 3 * s);
        paint.setStrokeJoin(Paint.Join.ROUND);
        path.reset();
        path.moveTo(x + 0.2f * w, y + fw * 0.5f);
        path.lineTo(nailX, nailY);
        path.lineTo(x + 0.8f * w, y + fw * 0.5f);
        canvas.drawPath(path, paint);
        fillWith(n.frameInner, alpha);
        canvas.drawCircle(nailX, nailY, 7 * s, paint);
        fillWith(n.frameAccent, alpha);
        canvas.drawCircle(nailX - 2 * s, nailY - 2 * s, 3 * s, paint);

        // The moulding.
        fillRectIn(n, 0, n.frameInner, alpha);
        fillRectIn(n, 3 * s, n.frameColor, alpha);
        fillRectIn(n, fw * 0.5f, 0x26000000, alpha);
        strokeRectIn(n, fw * 0.28f, n.frameAccent, 2.5f * s, alpha);
        strokeRectIn(n, fw - 1.5f * s, n.frameInner, 3 * s, alpha);
        strokeWith(n.frameInner, alpha, 1.5f * s);
        canvas.drawLine(x, y, x + fw, y + fw, paint);
        canvas.drawLine(x + w, y, x + w - fw, y + fw, paint);
        canvas.drawLine(x, y + h, x + fw, y + h - fw, paint);
        canvas.drawLine(x + w, y + h, x + w - fw, y + h - fw, paint);

        // Mat and canvas.
        fillRectIn(n, fw, n.frameMat, alpha);
        fillRectIn(n, fw + 12 * s, n.color, alpha);
        strokeRectIn(n, fw + 12 * s, 0x30000000, 1.5f * s, alpha);

        // Ornaments.
        List<float[]> spots = new ArrayList<>();
        spots.add(new float[] { x + fw / 2, y + fw / 2 });
        spots.add(new float[] { x + w - fw / 2, y + fw / 2 });
        spots.add(new float[] { x + fw / 2, y + h - fw / 2 });
        spots.add(new float[] { x + w - fw / 2, y + h - fw / 2 });
        if (w > 6 * fw) {
            spots.add(new float[] { x + w / 2, y + fw / 2 });
            spots.add(new float[] { x + w / 2, y + h - fw / 2 });
        }
        float d = fw * 0.34f;
        for (float[] c : spots) {
            path.reset();
            path.moveTo(c[0], c[1] - d);
            path.lineTo(c[0] + d, c[1]);
            path.lineTo(c[0], c[1] + d);
            path.lineTo(c[0] - d, c[1]);
            path.close();
            fillWith(n.frameAccent, alpha);
            canvas.drawPath(path, paint);
            fillWith(n.frameInner, alpha);
            canvas.drawCircle(c[0], c[1], fw * 0.1f, paint);
        }
    }

    /** `paintText` in canvasRenderer.ts. */
    private void paintText(Node n, float alpha) {
        float x = n.x;
        float y = n.y + n.ascent * n.size;
        if ("marker".equals(n.effect)) {
            // A highlighter stroke across the lower half of the words, leaning right.
            float x0 = n.x - n.effectWidth;
            float w0 = n.w + 2 * n.effectWidth;
            float y0 = n.y + 0.5f * n.h;
            float h0 = 0.42f * n.h;
            float k = 0.3f * h0;
            path.reset();
            path.moveTo(x0 + k, y0);
            path.lineTo(x0 + w0, y0);
            path.lineTo(x0 + w0 - k, y0 + h0);
            path.lineTo(x0, y0 + h0);
            path.close();
            fillWith(n.effectColor, alpha);
            canvas.drawPath(path, paint);
        }
        if ("outline".equals(n.effect)) {
            strokeWith(n.effectColor, alpha, n.effectWidth);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setTypeface(face(n.fontKey));
            paint.setTextSize(n.size);
            canvas.drawText(n.text, x, y, paint);
        }
        if ("shadow".equals(n.effect) || "glow".equals(n.effect) || "marker".equals(n.effect)) {
            fillWith(n.color, alpha);
            paint.setTypeface(face(n.fontKey));
            paint.setTextSize(n.size);
            int shadow = "marker".equals(n.effect) ? 0x8C000000 : n.effectColor;
            int shadowAlpha = Math.round(Color.alpha(shadow) * Math.max(0, Math.min(1, alpha)));
            // Android's shadow radius is about half a canvas `shadowBlur`.
            paint.setShadowLayer(Math.max(0.5f, n.effectBlur / 2), 0, n.effectDy,
                (shadowAlpha << 24) | (shadow & 0x00FFFFFF));
            canvas.drawText(n.text, x, y, paint);
            if ("glow".equals(n.effect)) canvas.drawText(n.text, x, y, paint);
            paint.clearShadowLayer();
        }
        fillWith(n.color, alpha);
        paint.setTypeface(face(n.fontKey));
        paint.setTextSize(n.size);
        canvas.drawText(n.text, x, y, paint);
    }

    private void paintBadge(Node n, float alpha) {
        float cx = n.x + n.w / 2;
        float cy = n.y + n.h / 2;
        boolean ring = Color.alpha(n.ring) > 0;
        if ("circle".equals(n.shape)) {
            float r = Math.min(n.w, n.h) / 2;
            fillWith(n.bg, alpha);
            canvas.drawCircle(cx, cy, r, paint);
            if (ring) {
                strokeWith(n.ring, alpha, r * 0.05f);
                paint.setPathEffect(new DashPathEffect(new float[] { r * 0.12f, r * 0.08f }, 0));
                canvas.drawCircle(cx, cy, r * 0.84f, paint);
                paint.setPathEffect(null);
            }
        } else if ("burst".equals(n.shape)) {
            float r = Math.min(n.w, n.h) / 2;
            int spikes = 14;
            path.reset();
            for (int i = 0; i < spikes * 2; i++) {
                float radius = i % 2 == 0 ? r : r * 0.8f;
                double angle = -Math.PI / 2 + i * Math.PI / spikes;
                float px = cx + radius * (float) Math.cos(angle);
                float py = cy + radius * (float) Math.sin(angle);
                if (i == 0) path.moveTo(px, py);
                else path.lineTo(px, py);
            }
            path.close();
            fillWith(n.bg, alpha);
            canvas.drawPath(path, paint);
        } else {
            fillWith(n.bg, alpha);
            roundRect(n.x, n.y, n.w, n.h, n.h * 0.3f);
            if (ring) {
                float inset = n.h * 0.12f;
                strokeWith(n.ring, alpha, n.h * 0.05f);
                paint.setPathEffect(new DashPathEffect(new float[] { n.h * 0.1f, n.h * 0.07f }, 0));
                roundRect(n.x + inset, n.y + inset, n.w - 2 * inset, n.h - 2 * inset, n.h * 0.2f);
                paint.setPathEffect(null);
            }
        }
        fillWith(n.color, alpha);
        paint.setTypeface(face(n.fontKey));
        paint.setTextSize(n.size);
        float tw = paint.measureText(n.text);
        float top = cy - (n.ascent + n.descent) * n.size / 2;
        canvas.drawText(n.text, cx - tw / 2, top + n.ascent * n.size, paint);
    }
}
