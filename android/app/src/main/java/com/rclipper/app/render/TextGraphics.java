package com.rclipper.app.render;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * The manifest's `textGraphics`: a style pack (pure data), the accent colour,
 * the fonts to download and the timed items.
 *
 * THE REFERENCE IS `src/config/textGraphicStyles.ts` (the pack's fields) and
 * `src/lib/textGraphics/plan.ts` (the items). Parsing is lenient on purpose:
 * {@link #parse} returns null for anything it cannot read, and the video is
 * then rendered without text graphics rather than failing.
 */
public final class TextGraphics {

    public static final class Anim {
        public final String kind;
        public final double delay;
        public final double dur;

        Anim(String kind, double delay, double dur) {
            this.kind = kind;
            this.delay = delay;
            this.dur = dur;
        }
    }

    public static final class Idle {
        public final String kind;
        public final double amp;
        public final double period;

        Idle(String kind, double amp, double period) {
            this.kind = kind;
            this.amp = amp;
            this.period = period;
        }
    }

    public static final class Font {
        public final String key;
        public final String url;
        public final float ascent;
        public final float descent;

        Font(String key, String url, float ascent, float descent) {
            this.key = key;
            this.url = url;
            this.ascent = ascent;
            this.descent = descent;
        }
    }

    public static final class Item {
        public final String kind;
        public final double start;
        public final double end;
        public final String title;
        public final String sub;
        public final String kicker;
        public final String num;
        public final String badge;
        public final String brand;
        public final String place;
        /** "" = the pack's default position for the kind. */
        public final String position;

        Item(JSONObject json) throws JSONException {
            kind = json.getString("kind");
            start = json.getDouble("start");
            end = json.getDouble("end");
            title = json.optString("title", "");
            sub = json.optString("sub", "");
            kicker = json.optString("kicker", "");
            num = json.optString("num", "");
            badge = json.optString("badge", "");
            brand = json.optString("brand", "");
            place = json.optString("place", "");
            position = json.optString("position", "");
        }
    }

    public final String styleId;
    public final int accent;
    /** role (title/body/badge/hook) → font key. */
    public final Map<String, String> fonts;
    public final Map<String, Float> sizes;
    /** Raw colour strings: "#RRGGBB", "#RRGGBBAA" or "accent". */
    public final Map<String, String> colors;
    /** card | none | postit | painting | ribbon | bubble. */
    public final String frame;
    /** Painting: moulding width. Ribbon: notch depth. Reference px. */
    public final float frameWidth;
    /** plain | shadow | outline | glow. */
    public final String textEffect;
    /** Default positions per item kind. */
    public final Map<String, String> positions;
    public final float cardRadius;
    public final float barWidth;
    public final boolean underline;
    public final String badgeShape;
    public final float badgeRotate;
    public final float tiltDeg;
    public final float shadowDx;
    public final float shadowDy;
    public final float ctaRadius;
    public final boolean hookDot;
    public final boolean uppercaseSub;
    public final Map<String, Anim> motion;
    public final Idle badgeIdle;
    public final Idle buttonIdle;
    public final String exitKind;
    public final double exitDur;
    public final List<Font> fontFiles;
    public final List<Item> items;

    private TextGraphics(JSONObject json) throws JSONException {
        JSONObject style = json.getJSONObject("style");
        styleId = style.getString("id");
        accent = parseColor(json.getString("accent"), 0xFFD7262E);

        fonts = stringMap(style.getJSONObject("fonts"));
        colors = stringMap(style.getJSONObject("colors"));
        sizes = new HashMap<>();
        JSONObject sizeJson = style.getJSONObject("sizes");
        for (Iterator<String> keys = sizeJson.keys(); keys.hasNext(); ) {
            String key = keys.next();
            sizes.put(key, (float) sizeJson.getDouble(key));
        }

        JSONObject shape = style.getJSONObject("shape");
        frame = shape.optString("frame", "card");
        frameWidth = (float) shape.optDouble("frameWidth", 0);
        textEffect = shape.optString("textEffect", "plain");
        JSONObject positionJson = style.optJSONObject("positions");
        positions = positionJson != null ? stringMap(positionJson) : new HashMap<>();
        cardRadius = (float) shape.optDouble("cardRadius", 16);
        barWidth = (float) shape.optDouble("barWidth", 0);
        underline = shape.optBoolean("underline", false);
        badgeShape = shape.optString("badge", "circle");
        badgeRotate = (float) shape.optDouble("badgeRotate", 0);
        tiltDeg = (float) shape.optDouble("tiltDeg", 0);
        shadowDx = (float) shape.optDouble("shadowDx", 0);
        shadowDy = (float) shape.optDouble("shadowDy", 0);
        ctaRadius = (float) shape.optDouble("ctaRadius", 24);
        hookDot = shape.optBoolean("hookDot", false);
        uppercaseSub = shape.optBoolean("uppercaseSub", false);

        JSONObject motionJson = style.getJSONObject("motion");
        motion = new HashMap<>();
        Idle badgeIdleValue = new Idle("none", 0, 0);
        Idle buttonIdleValue = new Idle("none", 0, 0);
        String exitKindValue = "fade";
        double exitDurValue = 0.3;
        for (Iterator<String> keys = motionJson.keys(); keys.hasNext(); ) {
            String key = keys.next();
            JSONObject entry = motionJson.getJSONObject(key);
            if (key.equals("badgeIdle") || key.equals("buttonIdle")) {
                Idle idle = new Idle(
                    entry.optString("kind", "none"),
                    entry.optDouble("amp", 0),
                    entry.optDouble("period", 0));
                if (key.equals("badgeIdle")) badgeIdleValue = idle;
                else buttonIdleValue = idle;
            } else if (key.equals("exit")) {
                exitKindValue = entry.optString("kind", "fade");
                exitDurValue = entry.optDouble("dur", 0.3);
            } else {
                motion.put(key, new Anim(
                    entry.optString("kind", "fade"),
                    entry.optDouble("delay", 0),
                    entry.optDouble("dur", 0.3)));
            }
        }
        badgeIdle = badgeIdleValue;
        buttonIdle = buttonIdleValue;
        exitKind = exitKindValue;
        exitDur = exitDurValue;

        List<Font> fontList = new ArrayList<>();
        JSONArray fontArray = json.optJSONArray("fonts");
        if (fontArray != null) {
            for (int i = 0; i < fontArray.length(); i++) {
                JSONObject f = fontArray.getJSONObject(i);
                fontList.add(new Font(
                    f.getString("key"),
                    f.getString("url"),
                    (float) f.optDouble("ascent", 1.0),
                    (float) f.optDouble("descent", 0.3)));
            }
        }
        fontFiles = Collections.unmodifiableList(fontList);

        List<Item> itemList = new ArrayList<>();
        JSONArray itemArray = json.getJSONArray("items");
        for (int i = 0; i < itemArray.length(); i++) {
            itemList.add(new Item(itemArray.getJSONObject(i)));
        }
        items = Collections.unmodifiableList(itemList);
    }

    /** The manifest's `textGraphics`, or null when absent or unreadable. */
    public static TextGraphics parse(JSONObject manifestJson) {
        JSONObject json = manifestJson.optJSONObject("textGraphics");
        if (json == null) return null;
        try {
            TextGraphics parsed = new TextGraphics(json);
            return parsed.items.isEmpty() ? null : parsed;
        } catch (JSONException | RuntimeException error) {
            return null;
        }
    }

    public float size(String name, float fallback) {
        Float value = sizes.get(name);
        return value != null ? value : fallback;
    }

    public Anim anim(String name) {
        return motion.get(name);
    }

    /** A named colour of the pack, with "accent" resolved. */
    public int color(String name) {
        String raw = colors.get(name);
        return resolve(raw == null ? "#00000000" : raw);
    }

    public int resolve(String raw) {
        if ("accent".equals(raw)) return accent;
        return parseColor(raw, 0x00000000);
    }

    public Font font(String key) {
        for (Font font : fontFiles) if (font.key.equals(key)) return font;
        return null;
    }

    /** "#RRGGBB" or "#RRGGBBAA" → ARGB. */
    static int parseColor(String hex, int fallback) {
        try {
            if (hex == null || !hex.startsWith("#")) return fallback;
            if (hex.length() == 7) return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
            if (hex.length() == 9) {
                int rgb = Integer.parseInt(hex.substring(1, 7), 16);
                int alpha = Integer.parseInt(hex.substring(7, 9), 16);
                return (alpha << 24) | rgb;
            }
        } catch (RuntimeException ignored) {
            // fall through
        }
        return fallback;
    }

    private static Map<String, String> stringMap(JSONObject json) throws JSONException {
        Map<String, String> map = new HashMap<>();
        for (Iterator<String> keys = json.keys(); keys.hasNext(); ) {
            String key = keys.next();
            map.put(key, json.getString(key));
        }
        return map;
    }
}
