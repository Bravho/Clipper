import UIKit
import CoreGraphics
import QuartzCore
import AVFoundation

/// Draws the caption stack and builds the template layer, matching the server's
/// styled render, `remotion/TemplatedVideo.tsx`.
///
/// The counterpart of Android's `CaptionPainter` and `TemplatePainter`; every
/// number is read off that composition (and restated in
/// `src/lib/mobile/deviceRenderCaptions.ts`). iOS differs in HOW, not in what:
/// the final export uses `AVVideoCompositionCoreAnimationTool`, so a caption cue
/// is drawn once into an image and timed by Core Animation, and the template is
/// a tree of `CAShapeLayer`s whose draw-on strokes, bracket ease-in and pulsing
/// ripples are ordinary Core Animation animations on the video's timeline.
///
/// Lengths use the composition's scale, `s = min(width, height) / 1080`.
enum OverlayPainter {

    // ── Captions, from `Subtitles` in TemplatedVideo.tsx ───────────────────
    private static let referenceShortSide: CGFloat = 1080
    static let stackBottom: CGFloat = 150
    private static let lineGap: CGFloat = 16
    private static let sidePadding: CGFloat = 48
    private static let lineHeight: CGFloat = 1.22
    private static let strokeWidth: CGFloat = 6
    /// The composition's text-shadow is plain CSS pixels (unscaled).
    private static let shadowOffset = CGSize(width: 3, height: 3)
    private static let shadowBlur: CGFloat = 6
    private static let plateRadius: CGFloat = 18
    private static let platePaddingY: CGFloat = 10
    private static let platePaddingX: CGFloat = 26
    private static let plateAlpha: CGFloat = 0.4
    static let appearSeconds: Double = 0.15
    static let appearScaleFrom: CGFloat = 0.96

    /// The composition's single scaling rule: the short side against 1080.
    static func scale(for canvas: CGSize) -> CGFloat {
        min(canvas.width, canvas.height) / referenceShortSide
    }

    private static func fontSize(for language: String) -> CGFloat {
        switch language {
        case "th": return 62
        case "en": return 52
        case "zh": return 50
        default: return 52
        }
    }

    /// Longer than this, a cue is split into two balanced lines.
    private static func maxChars(for language: String) -> Int {
        switch language {
        case "th": return 26
        case "en": return 30
        case "zh": return 16
        default: return 30
        }
    }

    private static func color(for language: String) -> UIColor {
        language == "zh"
            ? UIColor(red: 1, green: 0xE0 / 255, blue: 0x66 / 255, alpha: 1)
            : .white
    }

    /// Weight 800 maps to the heaviest system weight iOS offers for the default
    /// family; Thai and Simplified Chinese come through font fallback, as they
    /// do in the composition's font stacks.
    private static func font(size: CGFloat) -> UIFont {
        UIFont.systemFont(ofSize: size, weight: .heavy)
    }

    /// The drawn cue plus its size, so the caller can place the layer.
    struct DrawnCaption {
        let image: UIImage
        let size: CGSize
    }

    /// `wrapCaption`: one line at or under the language's budget, otherwise
    /// two lines balanced by length on word boundaries — spaces for English,
    /// the system's dictionary word breaks for Thai and Chinese (the same ICU
    /// data `Intl.Segmenter` uses in the browser).
    static func wrapCaption(_ text: String, maxChars: Int) -> [String] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > maxChars else { return [trimmed] }
        if trimmed.rangeOfCharacter(from: .whitespaces) != nil {
            let words = trimmed.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            return balanceTwoLines(words, joiner: " ")
        }
        var units: [String] = []
        trimmed.enumerateSubstrings(
            in: trimmed.startIndex..<trimmed.endIndex, options: .byWords
        ) { _, _, enclosingRange, _ in
            // The ENCLOSING range carries the punctuation after a word too, so
            // joining the units gives back the whole caption.
            units.append(String(trimmed[enclosingRange]))
        }
        if units.isEmpty || units.joined() != trimmed {
            units = trimmed.map { String($0) }
        }
        return balanceTwoLines(units, joiner: "")
    }

    private static func balanceTwoLines(_ units: [String], joiner: String) -> [String] {
        guard units.count >= 2 else { return [units.joined(separator: joiner)] }
        let total = units.reduce(0) { $0 + $1.count } + joiner.count * (units.count - 1)
        let target = Int((Double(total) / 2).rounded(.up))
        var accumulated = 0
        var best = 1
        var bestDiff = Int.max
        for index in 0..<(units.count - 1) {
            accumulated += units[index].count + joiner.count
            let diff = abs(accumulated - target)
            if diff < bestDiff {
                bestDiff = diff
                best = index + 1
            }
        }
        return [
            units[0..<best].joined(separator: joiner),
            units[best...].joined(separator: joiner),
        ]
    }

    /// Render one cue's whole stack — every requested language, plates and all —
    /// into a single image sized to the canvas width.
    ///
    /// Returns nil when the cue has no text in any requested language, so the
    /// caller adds no layer for it rather than an invisible one.
    static func drawCaption(
        _ caption: RenderManifest.Caption,
        languages: [String],
        canvas: CGSize
    ) -> DrawnCaption? {
        let s = scale(for: canvas)
        let maxTextWidth = canvas.width - 2 * sidePadding * s - 2 * platePaddingX * s
        guard maxTextWidth > 0 else { return nil }

        struct Line {
            let attributed: NSAttributedString
            let textSize: CGSize
        }

        var lines: [Line] = []
        for language in languages {
            let text = caption.text(for: language)
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }

            let size = fontSize(for: language) * s
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            paragraph.lineHeightMultiple = lineHeight
            paragraph.lineBreakMode = .byWordWrapping

            let attributes: [NSAttributedString.Key: Any] = [
                .font: font(size: size),
                .foregroundColor: color(for: language),
                .paragraphStyle: paragraph,
            ]
            let wrapped = wrapCaption(text, maxChars: maxChars(for: language))
                .joined(separator: "\n")
            let attributed = NSAttributedString(string: wrapped, attributes: attributes)

            let bounding = attributed.boundingRect(
                with: CGSize(width: maxTextWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            )
            lines.append(Line(
                attributed: attributed,
                textSize: CGSize(width: ceil(bounding.width), height: ceil(bounding.height))
            ))
        }
        guard !lines.isEmpty else { return nil }

        let gap = lineGap * s
        var stackHeight: CGFloat = 0
        for (index, line) in lines.enumerated() {
            stackHeight += line.textSize.height + 2 * platePaddingY * s
            if index > 0 { stackHeight += gap }
        }

        let canvasSize = CGSize(width: canvas.width, height: stackHeight)
        let renderer = UIGraphicsImageRenderer(size: canvasSize, format: transparentFormat())
        let image = renderer.image { context in
            var y: CGFloat = 0
            for line in lines {
                let plateHeight = line.textSize.height + 2 * platePaddingY * s
                let plateWidth = line.textSize.width + 2 * platePaddingX * s
                let plateRect = CGRect(
                    x: (canvas.width - plateWidth) / 2, y: y,
                    width: plateWidth, height: plateHeight
                )

                context.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
                UIColor.black.withAlphaComponent(plateAlpha).setFill()
                UIBezierPath(roundedRect: plateRect, cornerRadius: plateRadius * s).fill()

                let textRect = CGRect(
                    x: (canvas.width - line.textSize.width) / 2,
                    y: y + platePaddingY * s,
                    width: line.textSize.width,
                    height: line.textSize.height
                )

                // `paint-order: stroke fill`, done as TWO passes. A negative
                // stroke width ("stroke and fill" in one pass) draws the fill
                // FIRST and the outline ON TOP, so half the outline ate into
                // the letters — fatal for Thai's thin loops and small heads —
                // and the per-glyph shadow fell across neighbouring glyphs.
                //
                // Pass 1: outline only (positive width), carrying the shadow.
                // CSS strokes 6px centred on the outline and the fill hides
                // the inner half, so the stroke is drawn at full width here.
                context.cgContext.saveGState()
                context.cgContext.setShadow(
                    offset: shadowOffset,
                    blur: shadowBlur,
                    color: UIColor.black.withAlphaComponent(0.9).cgColor
                )
                let outline = NSMutableAttributedString(attributedString: line.attributed)
                outline.addAttributes([
                    .strokeColor: UIColor.black,
                    .strokeWidth: (2 * strokeWidth * s) / (fontSizeOf(line.attributed) / 100),
                ], range: NSRange(location: 0, length: outline.length))
                outline.draw(with: textRect, options: [.usesLineFragmentOrigin], context: nil)
                context.cgContext.restoreGState()

                // Pass 2: the plain fill on top, no stroke and no shadow, so
                // every letterform keeps its full shape and colour.
                context.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
                line.attributed.draw(with: textRect, options: [.usesLineFragmentOrigin], context: nil)

                y += plateHeight + gap
            }
        }
        return DrawnCaption(image: image, size: canvasSize)
    }

    /// `NSAttributedString.strokeWidth` is a PERCENTAGE of the font size, not a
    /// point value, which is the single easiest thing to get wrong here — a
    /// 6-point outline written as `6` is a 6% outline that all but disappears.
    private static func fontSizeOf(_ attributed: NSAttributedString) -> CGFloat {
        guard attributed.length > 0,
              let font = attributed.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        else { return 52 }
        return font.pointSize
    }

    // ── Template ────────────────────────────────────────────────────────────
    //
    // THE REFERENCE IS `src/lib/motionTemplates/templateRenderer.ts` (motion in
    // `motion.ts`), which Android's `TemplatePainter.java` ports call for call.
    // Core Animation cannot run a draw function per frame, so here every
    // moving property is SAMPLED from the same formulas once per video frame
    // (`TemplateClock`) into a linear keyframe animation on the video's
    // timeline. The geometry is static paths; what moves is transform,
    // opacity, strokeStart / strokeEnd and position. Change all three
    // renderers together.

    /// The look this build draws: by id, with the catalogue's frame as the
    /// fallback for an id this build does not know.
    static func look(_ template: RenderManifest.Template) -> String {
        switch template.id {
        case "clean_frame", "framed_cream", "editorial", "bold_pop", "cinematic", "none":
            return template.id
        default:
            if template.frame == "rounded_inset" { return "framed_cream" }
            if template.frame == "corner_bracket" { return "clean_frame" }
            return "none"
        }
    }

    static func hasTemplate(_ template: RenderManifest.Template) -> Bool {
        look(template) != "none"
    }

    /// framed_cream shows the video inside a card rather than full-bleed.
    static func isInset(_ template: RenderManifest.Template) -> Bool {
        look(template) == "framed_cream"
    }

    /// The card: top 6.5 %, left/right 5.5 %, bottom 13 % (top-left origin).
    private static func cardRect(_ canvas: CGSize) -> CGRect {
        CGRect(x: canvas.width * 0.055, y: canvas.height * 0.065,
               width: canvas.width * (1 - 0.11), height: canvas.height * (1 - 0.065 - 0.13))
    }

    /// The video's window inside the card (22 px of padding), top-left origin.
    static func insetWindow(_ canvas: CGSize) -> CGRect {
        cardRect(canvas).insetBy(dx: 22, dy: 22)
    }

    /// Where the video layer goes for the inset look, in Core Animation's
    /// bottom-left coordinates: the full canvas scaled to COVER the window and
    /// centred on it. The overflow sits under the card and canvas.
    static func insetVideoFrame(_ canvas: CGSize) -> CGRect {
        let window = insetWindow(canvas)
        let scale = max(window.width / canvas.width, window.height / canvas.height)
        let size = CGSize(width: canvas.width * scale, height: canvas.height * scale)
        let centerX = window.midX
        let centerYFromBottom = canvas.height - window.midY
        return CGRect(x: centerX - size.width / 2, y: centerYFromBottom - size.height / 2,
                      width: size.width, height: size.height)
    }

    // MARK: Template motion (motion.ts)

    /// The Look's timeline: cut times and the video's length (nil = unknown).
    struct TemplateTimeline {
        let beats: [Double]
        let end: Double?

        /// `normaliseTimeline`: finite, ascending, strictly inside (0.3, end − 0.3).
        init(_ template: RenderManifest.Template) {
            let end = template.endSeconds.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
            self.end = end
            beats = (template.beats ?? [])
                .filter { $0.isFinite && $0 > 0.3 && (end == nil || $0 < end! - 0.3) }
                .sorted()
        }
    }

    enum TM {
        static func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }
        static func easeOutCubic(_ x: Double) -> Double { 1 - pow(1 - clamp01(x), 3) }
        static func easeInOutCubic(_ x: Double) -> Double {
            let v = clamp01(x)
            return v < 0.5 ? 4 * v * v * v : 1 - pow(-2 * v + 2, 3) / 2
        }
        static func easeInOutSine(_ x: Double) -> Double { -(cos(Double.pi * clamp01(x)) - 1) / 2 }
        static func easeOutBack(_ x: Double) -> Double {
            let v = clamp01(x)
            let c1 = 1.70158
            let c3 = c1 + 1
            return 1 + c3 * pow(v - 1, 3) + c1 * pow(v - 1, 2)
        }
        static func ramp(_ t: Double, _ start: Double, _ duration: Double) -> Double {
            duration <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / duration)
        }
        static func wave(_ t: Double, _ period: Double, _ phase: Double = 0) -> Double {
            sin(2 * Double.pi * (t / period + phase))
        }
        static func beatEnvelope(_ t: Double, _ beats: [Double], _ attack: Double, _ decay: Double) -> Double {
            var best = 0.0
            for b in beats {
                let d = t - b
                var v = 0.0
                if d >= -attack && d < 0 { v = easeOutCubic((d + attack) / attack) }
                else if d >= 0 && d < decay { v = 1 - easeInOutSine(d / decay) }
                best = max(best, v)
            }
            return best
        }
        static func sceneIndex(_ t: Double, _ beats: [Double]) -> Int {
            beats.reduce(0) { $0 + (t >= $1 ? 1 : 0) }
        }
        static func sceneFraction(_ t: Double, _ tl: TemplateTimeline) -> Double {
            let index = sceneIndex(t, tl.beats)
            let start = index == 0 ? 0 : tl.beats[index - 1]
            let stop: Double? = index < tl.beats.count ? tl.beats[index] : tl.end
            guard let stop, stop > start else { return 1 }
            return clamp01((t - start) / (stop - start))
        }
        static func videoProgress(_ t: Double, _ tl: TemplateTimeline) -> Double {
            guard let end = tl.end, end > 0 else { return 0 }
            return clamp01(t / end)
        }
        static func outro(_ t: Double, _ tl: TemplateTimeline, _ length: Double) -> Double {
            guard let end = tl.end, end > length * 1.5 else { return 0 }
            return ramp(t, end - length, length)
        }
        /// Progress through the active beat window, or −1.
        static func beatProgress(_ t: Double, _ beats: [Double], _ lead: Double, _ duration: Double) -> Double {
            var found = -1.0
            for b in beats {
                let start = b - lead
                if t >= start && t < start + duration { found = (t - start) / duration }
            }
            return found
        }
    }

    /// One sample per video frame across the whole export.
    struct TemplateClock {
        let duration: Double
        let samples: Int

        init(duration: Double, fps: Int) {
            self.duration = max(0.04, duration.isFinite ? duration : 0.04)
            let frames = Int((self.duration * Double(max(1, fps))).rounded())
            samples = max(1, min(frames, 7200))
        }

        func time(_ k: Int) -> Double { duration * Double(k) / Double(samples) }
    }

    /// A keyframe animation sampling `value(t)` at every frame time.
    private static func track(_ keyPath: String, _ clock: TemplateClock,
                              _ value: (Double) -> Any) -> CAKeyframeAnimation {
        let animation = CAKeyframeAnimation(keyPath: keyPath)
        var values: [Any] = []
        var times: [NSNumber] = []
        values.reserveCapacity(clock.samples + 1)
        times.reserveCapacity(clock.samples + 1)
        for k in 0...clock.samples {
            values.append(value(clock.time(k)))
            times.append(NSNumber(value: Double(k) / Double(clock.samples)))
        }
        animation.values = values
        animation.keyTimes = times
        animation.calculationMode = .linear
        animation.beginTime = AVCoreAnimationBeginTimeAtZero
        animation.duration = clock.duration
        animation.fillMode = .both
        animation.isRemovedOnCompletion = false
        return animation
    }

    private static func num(_ x: Double) -> NSNumber { NSNumber(value: Float(x)) }

    private static func transformValue(tx: CGFloat = 0, ty: CGFloat = 0, rotate: CGFloat = 0,
                                       sx: CGFloat = 1, sy: CGFloat = 1) -> NSValue {
        var m = CATransform3DMakeTranslation(tx, ty, 0)
        if rotate != 0 { m = CATransform3DRotate(m, rotate, 0, 0, 1) }
        if sx != 1 || sy != 1 { m = CATransform3DScale(m, sx, sy, 1) }
        return NSValue(caTransform3D: m)
    }

    /// The animated template layer for `AVVideoCompositionCoreAnimationTool`,
    /// or nil for "none". Shapes are drawn in top-left coordinates inside a
    /// geometry-flipped container; text images go in an unflipped one.
    static func templateLayer(_ template: RenderManifest.Template, canvas: CGSize,
                              durationSeconds: Double, fps: Int) -> CALayer? {
        let look = look(template)
        guard look != "none" else { return nil }
        let palette = Palette(template.palette)
        let s = scale(for: canvas)
        let tl = TemplateTimeline(template)
        // Sample across the whole export (the server's length is an estimate).
        let exported = durationSeconds.isFinite ? durationSeconds : 0
        let clock = TemplateClock(duration: max(exported, tl.end ?? 0), fps: fps)

        let root = CALayer()
        root.frame = CGRect(origin: .zero, size: canvas)
        let container = CALayer()
        container.frame = root.bounds
        container.isGeometryFlipped = true
        root.addSublayer(container)

        switch look {
        case "clean_frame":
            buildCleanFrame(in: container, canvas: canvas, s: s, palette: palette, tl: tl, clock: clock)
        case "framed_cream":
            buildFramedCream(in: container, canvas: canvas, s: s, palette: palette, tl: tl, clock: clock)
        case "editorial":
            buildEditorial(in: container, root: root, canvas: canvas, s: s, palette: palette, tl: tl, clock: clock)
        case "bold_pop":
            buildBoldPop(in: container, canvas: canvas, s: s, palette: palette, tl: tl, clock: clock)
        case "cinematic":
            buildCinematic(in: container, canvas: canvas, s: s, palette: palette, tl: tl, clock: clock)
        default:
            break
        }
        return root
    }

    private static func shapeLayer(_ path: CGPath, frame: CGRect) -> CAShapeLayer {
        let layer = CAShapeLayer()
        layer.frame = frame
        layer.path = path
        layer.fillColor = nil
        layer.strokeColor = nil
        return layer
    }

    /// A shape layer whose origin sits at `point`, for paths drawn round (0, 0)
    /// that scale and rotate about their centre.
    private static func pinnedLayer(_ path: CGPath, at point: CGPoint) -> CAShapeLayer {
        let layer = CAShapeLayer()
        layer.bounds = .zero
        layer.position = point
        layer.path = path
        layer.fillColor = nil
        layer.strokeColor = nil
        return layer
    }

    /// `roundRectFromTop`: clockwise from the top edge's midpoint.
    private static func roundRectFromTop(_ r: CGRect, radius: CGFloat) -> CGPath {
        let k = min(radius, r.width / 2, r.height / 2)
        let p = CGMutablePath()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - k, y: r.minY))
        p.addArc(tangent1End: CGPoint(x: r.maxX, y: r.minY), tangent2End: CGPoint(x: r.maxX, y: r.minY + k), radius: k)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - k))
        p.addArc(tangent1End: CGPoint(x: r.maxX, y: r.maxY), tangent2End: CGPoint(x: r.maxX - k, y: r.maxY), radius: k)
        p.addLine(to: CGPoint(x: r.minX + k, y: r.maxY))
        p.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.minX, y: r.maxY - k), radius: k)
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + k))
        p.addArc(tangent1End: CGPoint(x: r.minX, y: r.minY), tangent2End: CGPoint(x: r.minX + k, y: r.minY), radius: k)
        p.closeSubpath()
        return p
    }

    // MARK: clean_frame

    private static let cleanCorners: [(CGFloat, CGFloat)] = [(1, 1), (-1, 1), (-1, -1), (1, -1)]

    private static func buildCleanFrame(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        let size = 90 * s
        let inset = 44 * s
        let border = max(3, 7 * s)
        let radius = 22 * s
        let half = border / 2
        let r = max(0, radius - half)
        let sd = Double(s)

        for (k, corner) in cleanCorners.enumerated() {
            let (dx, dy) = corner
            let x = dx > 0 ? inset : canvas.width - inset
            let y = dy > 0 ? inset : canvas.height - inset
            let cx = x + dx * half
            let cy = y + dy * half
            let path = CGMutablePath()
            path.move(to: CGPoint(x: x + dx * size, y: cy))
            path.addLine(to: CGPoint(x: cx + dx * r, y: cy))
            path.addQuadCurve(to: CGPoint(x: cx, y: cy + dy * r), control: CGPoint(x: cx, y: cy))
            path.addLine(to: CGPoint(x: cx, y: y + dy * size))

            let layer = shapeLayer(path, frame: container.bounds)
            layer.strokeColor = UIColor.white.cgColor
            layer.lineWidth = border
            layer.lineCap = .butt
            layer.lineJoin = .round
            layer.shadowColor = UIColor.black.cgColor
            layer.shadowOpacity = 0.55
            layer.shadowRadius = 2
            layer.shadowOffset = CGSize(width: 0, height: 1)
            layer.opacity = 0
            container.addSublayer(layer)

            func grow(_ t: Double) -> Double { TM.easeOutCubic(TM.ramp(t, 0.1 + 0.08 * Double(k), 0.65)) }
            layer.add(track("opacity", clock) { num(0.95 * grow($0)) }, forKey: "o")
            layer.add(track("strokeStart", clock) { num(0.5 - grow($0) / 2) }, forKey: "a")
            layer.add(track("strokeEnd", clock) { num(0.5 + grow($0) / 2) }, forKey: "b")
            layer.add(track("transform", clock) { t in
                let intro = TM.ramp(t, 0.1 + 0.08 * Double(k), 0.65)
                let slide = (1 - TM.easeOutBack(intro)) * 36 * sd
                let breathe = 5 * sd * TM.wave(t, 4.2) * TM.ramp(t, 0.8, 0.6)
                let punch = 16 * sd * TM.beatEnvelope(t, tl.beats, 0.06, 0.5)
                let close = 22 * sd * TM.easeInOutCubic(TM.outro(t, tl, 1.2))
                let o = CGFloat(slide + breathe - punch - close)
                return transformValue(tx: -dx * o, ty: -dy * o)
            }, forKey: "t")
        }

        // Ripples: diameter 0.15 → 1 of 32 % of the short side, opacity
        // 0 → 0.5 → 0 every 3.6 s, the second 1.8 s behind; faded in after 0.6 s.
        let ripples = CALayer()
        ripples.frame = container.bounds
        ripples.opacity = 0
        ripples.add(track("opacity", clock) { num(TM.ramp($0, 0.6, 0.6)) }, forKey: "o")
        container.addSublayer(ripples)
        let maxDiameter = min(canvas.width, canvas.height) * 0.32
        let center = CGPoint(x: canvas.width * 0.13, y: canvas.height * 0.84)
        let ringWidth = max(2, 2.5 * s)
        for delay in [0.0, 1.8] {
            let ring = CAShapeLayer()
            let rr = maxDiameter / 2 - ringWidth / 2
            ring.frame = CGRect(x: center.x - maxDiameter / 2, y: center.y - maxDiameter / 2,
                                width: maxDiameter, height: maxDiameter)
            ring.path = UIBezierPath(
                ovalIn: CGRect(x: ringWidth / 2, y: ringWidth / 2, width: rr * 2, height: rr * 2)).cgPath
            ring.fillColor = nil
            ring.strokeColor = palette.accent.cgColor
            ring.lineWidth = ringWidth
            ring.opacity = 0
            ripples.addSublayer(ring)

            let grow = CABasicAnimation(keyPath: "transform.scale")
            grow.fromValue = 0.15
            grow.toValue = 1.0
            let pulse = CAKeyframeAnimation(keyPath: "opacity")
            pulse.values = [0, 0.5, 0]
            pulse.keyTimes = [0, 0.15, 1]
            let group = CAAnimationGroup()
            group.animations = [grow, pulse]
            group.duration = 3.6
            group.repeatCount = .greatestFiniteMagnitude
            group.beginTime = AVCoreAnimationBeginTimeAtZero
            group.timeOffset = delay
            group.fillMode = .both
            group.isRemovedOnCompletion = false
            ring.add(group, forKey: nil)
        }

        buildSceneProgress(in: container, canvas: canvas, s: s, palette: palette, tl: tl, clock: clock)
    }

    private static func buildSceneProgress(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        func appear(_ t: Double) -> Double { TM.easeOutCubic(TM.ramp(t, 0.3, 0.5)) }
        guard tl.end != nil else {
            // No length: the plain accent bar.
            let bar = shapeLayer(UIBezierPath(
                roundedRect: CGRect(x: (canvas.width - 56 * s) / 2, y: 54 * s, width: 56 * s, height: 5 * s),
                cornerRadius: 2.5 * s).cgPath, frame: container.bounds)
            bar.fillColor = palette.accent.cgColor
            bar.opacity = 0
            bar.add(track("opacity", clock) { num(0.9 * appear($0)) }, forKey: "o")
            container.addSublayer(bar)
            return
        }
        let thickness = 5 * s
        let y = 54 * s + thickness / 2
        let total = 240 * s
        let gap = 10 * s
        var count = min(tl.beats.count + 1, 12)
        var seg = (total - gap * CGFloat(count - 1)) / CGFloat(count)
        if seg < 12 * s {
            count = 1
            seg = total
        }
        let left = (canvas.width - total) / 2
        let continuous = count == 1

        for i in 0..<count {
            let x0 = left + CGFloat(i) * (seg + gap)
            let line = CGMutablePath()
            line.move(to: CGPoint(x: x0 + thickness / 2, y: y))
            line.addLine(to: CGPoint(x: x0 + seg - thickness / 2, y: y))

            let trackLayer = shapeLayer(line, frame: container.bounds)
            trackLayer.strokeColor = UIColor.white.cgColor
            trackLayer.lineWidth = thickness
            trackLayer.lineCap = .round
            trackLayer.opacity = 0
            trackLayer.add(track("opacity", clock) { num(0.3 * appear($0)) }, forKey: "o")
            container.addSublayer(trackLayer)

            let fillLayer = shapeLayer(line, frame: container.bounds)
            fillLayer.strokeColor = palette.accent.cgColor
            fillLayer.lineWidth = thickness
            fillLayer.lineCap = .round
            fillLayer.opacity = 0
            fillLayer.strokeEnd = 0
            fillLayer.add(track("opacity", clock) { num(0.95 * appear($0)) }, forKey: "o")
            fillLayer.add(track("strokeEnd", clock) { t in
                if continuous { return num(TM.videoProgress(t, tl)) }
                let index = TM.sceneIndex(t, tl.beats)
                return num(i < index ? 1 : i == index ? TM.sceneFraction(t, tl) : 0)
            }, forKey: "e")
            container.addSublayer(fillLayer)
        }
    }

    // MARK: framed_cream

    private static func creamCardStroke(_ t: Double, _ tl: TemplateTimeline) -> (Double, Double, Double) {
        let close = TM.outro(t, tl, 1.4)
        if close > 0 { return (0, TM.easeInOutCubic(close), 0.9) }
        let p = TM.beatProgress(t, tl.beats, 0.15, 1.1)
        if p < 0 { return (0, 0, 0) }
        let head = TM.easeInOutCubic(p)
        return (max(0, head - 0.22), head, 1 - TM.ramp(p, 0.8, 0.2))
    }

    private static func mix(_ a: UIColor, _ b: UIColor, _ k: CGFloat) -> UIColor {
        var (ar, ag, ab, aa): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        var (br, bg, bb, ba): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        return UIColor(red: ar * (1 - k) + br * k, green: ag * (1 - k) + bg * k,
                       blue: ab * (1 - k) + bb * k, alpha: 1)
    }

    private static func buildFramedCream(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        let card = cardRect(canvas)
        let window = insetWindow(canvas)
        let short = min(canvas.width, canvas.height)
        let sd = Double(s)

        func holeMask() -> CAShapeLayer {
            let mask = CAShapeLayer()
            mask.frame = container.bounds
            let p = CGMutablePath()
            p.addRect(CGRect(origin: .zero, size: canvas))
            p.addPath(UIBezierPath(roundedRect: window, cornerRadius: 22).cgPath)
            mask.path = p
            mask.fillRule = .evenOdd
            mask.fillColor = UIColor.black.cgColor
            return mask
        }

        // The warm canvas: a diagonal wash, window left open.
        let wash = CAGradientLayer()
        wash.frame = container.bounds
        wash.colors = [palette.neutral.cgColor, mix(palette.neutral, palette.secondary, 0.22).cgColor]
        wash.startPoint = CGPoint(x: 0, y: 0)
        wash.endPoint = CGPoint(x: 1, y: 1)
        wash.mask = holeMask()
        container.addSublayer(wash)

        // Colour blobs drifting in the margins, never inside the window.
        let blobs = CALayer()
        blobs.frame = container.bounds
        blobs.mask = holeMask()
        blobs.opacity = 0
        blobs.add(track("opacity", clock) { num(TM.easeOutCubic(TM.ramp($0, 0, 0.8))) }, forKey: "o")
        container.addSublayer(blobs)
        let blobSpecs: [(CGFloat, UIColor, Float, (Double) -> CGPoint)] = [
            (short * 0.2, palette.accent, 0.16, { t in
                CGPoint(x: canvas.width * 0.92 + CGFloat(14 * sd * TM.wave(t, 7)),
                        y: canvas.height * 0.05 + CGFloat(10 * sd * TM.wave(t, 7, 0.25)))
            }),
            (short * 0.24, palette.primary, 0.12, { t in
                CGPoint(x: canvas.width * 0.06 + CGFloat(12 * sd * TM.wave(t, 9, 0.25)),
                        y: canvas.height * 0.93 + CGFloat(10 * sd * TM.wave(t, 9)))
            }),
        ]
        for (radius, color, alpha, at) in blobSpecs {
            let blob = pinnedLayer(UIBezierPath(
                ovalIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2)).cgPath,
                at: at(0))
            blob.fillColor = color.cgColor
            blob.opacity = alpha
            blob.add(track("position", clock) { NSValue(cgPoint: at($0)) }, forKey: "p")
            blobs.addSublayer(blob)
        }

        // The card around the window, with its shadow shaped like the card.
        let cardLayer = CAShapeLayer()
        cardLayer.frame = container.bounds
        let cardPath = CGMutablePath()
        cardPath.addPath(UIBezierPath(roundedRect: card, cornerRadius: 34).cgPath)
        cardPath.addPath(UIBezierPath(roundedRect: window, cornerRadius: 22).cgPath)
        cardLayer.path = cardPath
        cardLayer.fillRule = .evenOdd
        cardLayer.fillColor = UIColor.white.cgColor
        cardLayer.shadowColor = UIColor.black.cgColor
        cardLayer.shadowOpacity = 0.22
        cardLayer.shadowRadius = 21
        cardLayer.shadowOffset = CGSize(width: 0, height: 16)
        let shadowPath = CGMutablePath()
        shadowPath.addPath(UIBezierPath(roundedRect: card, cornerRadius: 34).cgPath)
        shadowPath.addPath(UIBezierPath(roundedRect: window, cornerRadius: 22).reversing().cgPath)
        cardLayer.shadowPath = shadowPath
        container.addSublayer(cardLayer)

        // Accent comet round the card on every cut; full outline at the end.
        let outline = card.insetBy(dx: 1.5 * s, dy: 1.5 * s)
        let comet = shapeLayer(roundRectFromTop(outline, radius: 34), frame: container.bounds)
        comet.strokeColor = palette.accent.cgColor
        comet.lineWidth = max(2, 4 * s)
        comet.lineCap = .round
        comet.opacity = 0
        comet.strokeStart = 0
        comet.strokeEnd = 0
        comet.add(track("strokeStart", clock) { num(creamCardStroke($0, tl).0) }, forKey: "a")
        comet.add(track("strokeEnd", clock) { num(creamCardStroke($0, tl).1) }, forKey: "b")
        comet.add(track("opacity", clock) { t in
            let c = creamCardStroke(t, tl)
            return num(c.1 > c.0 ? c.2 : 0)
        }, forKey: "o")
        container.addSublayer(comet)

        let ink = palette.primary
        let strokeWidth = max(2.5, 3.2 * s)
        let dash = Double(canvas.width * 2)
        func draw(_ t: Double) -> Double { TM.ramp(t, 0.2, 1.4) }

        // The branch, in its own units: draws on, then sways about (0, 60).
        let branch = CALayer()
        branch.bounds = .zero
        branch.position = CGPoint(x: canvas.width * 0.66, y: canvas.height * 0.9)
        branch.add(track("transform", clock) { t in
            let sway = CGFloat(2.5 * Double.pi / 180 * TM.wave(t, 5) * TM.ramp(t, 1.2, 0.8))
            var m = CATransform3DMakeScale(s, s, 1)
            m = CATransform3DTranslate(m, 0, 60, 0)
            m = CATransform3DRotate(m, sway, 0, 0, 1)
            m = CATransform3DTranslate(m, 0, -60, 0)
            return NSValue(caTransform3D: m)
        }, forKey: "t")
        container.addSublayer(branch)
        var branchPaths: [CGPath] = []
        let main = CGMutablePath()
        main.move(to: CGPoint(x: 0, y: 60))
        main.addCurve(to: CGPoint(x: 190, y: 6), control1: CGPoint(x: 60, y: 44), control2: CGPoint(x: 120, y: 40))
        branchPaths.append(main)
        for (x, y, c1, c2, e1, e2) in [
            (46.0, 48.0, 52.0, 26.0, 32.0, 18.0),
            (84.0, 40.0, 92.0, 18.0, 72.0, 8.0),
            (124.0, 30.0, 134.0, 8.0, 114.0, -4.0),
            (162.0, 16.0, 172.0, -4.0, 154.0, -16.0),
        ] {
            let leaf = CGMutablePath()
            leaf.move(to: CGPoint(x: x, y: y))
            leaf.addQuadCurve(to: CGPoint(x: e1, y: e2), control: CGPoint(x: c1, y: c2))
            branchPaths.append(leaf)
        }
        for path in branchPaths {
            let length = Double(approximateLength(path))
            let layer = shapeLayer(path, frame: .zero)
            layer.strokeColor = ink.withAlphaComponent(0.6).cgColor
            layer.lineWidth = strokeWidth
            layer.lineCap = .round
            layer.strokeEnd = 0
            layer.add(track("strokeEnd", clock) { num(min(1, draw($0) * dash / length)) }, forKey: "e")
            branch.addSublayer(layer)
        }

        // The wave: draws on, then drifts.
        let wave = CGMutablePath()
        var point = CGPoint(x: canvas.width * 0.14, y: canvas.height * 0.945)
        wave.move(to: point)
        let segment = canvas.width * 0.11
        let amplitude = 14 * s
        for _ in 0..<3 {
            wave.addQuadCurve(to: CGPoint(x: point.x + segment, y: point.y),
                              control: CGPoint(x: point.x + segment / 2, y: point.y - amplitude))
            point.x += segment
            wave.addQuadCurve(to: CGPoint(x: point.x + segment, y: point.y),
                              control: CGPoint(x: point.x + segment / 2, y: point.y + amplitude))
            point.x += segment
        }
        let waveLength = Double(approximateLength(wave))
        let waveLayer = shapeLayer(wave, frame: container.bounds)
        waveLayer.strokeColor = ink.withAlphaComponent(0.55).cgColor
        waveLayer.lineWidth = strokeWidth
        waveLayer.lineCap = .round
        waveLayer.strokeEnd = 0
        waveLayer.add(track("strokeEnd", clock) { num(min(1, draw($0) * dash / waveLength)) }, forKey: "e")
        waveLayer.add(track("transform", clock) { t in
            transformValue(tx: CGFloat(8 * sd * TM.wave(t, 6) * TM.ramp(t, 1.6, 0.6)))
        }, forKey: "t")
        container.addSublayer(waveLayer)

        // Three dots, bobbing out of phase.
        for (k, d) in [(0.12, 0.9, 4.0), (0.16, 0.93, 3.0), (0.1, 0.955, 3.0)].enumerated() {
            let radius = CGFloat(d.2) * s
            let dot = pinnedLayer(UIBezierPath(
                ovalIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2)).cgPath,
                at: CGPoint(x: canvas.width * CGFloat(d.0), y: canvas.height * CGFloat(d.1)))
            dot.fillColor = ink.cgColor
            dot.opacity = 0
            dot.add(track("opacity", clock) { num(0.5 * draw($0)) }, forKey: "o")
            dot.add(track("transform", clock) { t in
                transformValue(ty: CGFloat(4 * sd * TM.wave(t, 2.8, Double(k) / 3)))
            }, forKey: "t")
            container.addSublayer(dot)
        }

        // Sparkles: twinkle, and pop on every cut.
        for (x, y, r, phase, alpha) in [
            (canvas.width * 0.1, canvas.height * 0.04, 16 * s, 0.0, 0.8),
            (canvas.width * 0.88, canvas.height * 0.035, 10 * s, 0.5, 0.65),
        ] {
            let sparkle = pinnedLayer(star4(center: .zero, r: r), at: CGPoint(x: x, y: y))
            sparkle.fillColor = palette.accent.cgColor
            sparkle.opacity = 0
            sparkle.add(track("opacity", clock) { num(alpha * draw($0)) }, forKey: "o")
            sparkle.add(track("transform", clock) { t in
                let scale = CGFloat(1 + 0.15 * TM.wave(t, 2.4, phase)
                                    + 0.5 * TM.beatEnvelope(t, tl.beats, 0.06, 0.45))
                let spin = CGFloat(12 * Double.pi / 180 * TM.wave(t, 4.8, phase))
                return transformValue(rotate: spin, sx: scale, sy: scale)
            }, forKey: "t")
            container.addSublayer(sparkle)
        }
    }

    // MARK: editorial

    private static func buildEditorial(
        in container: CALayer, root: CALayer, canvas: CGSize, s: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        let top = CAGradientLayer()
        top.frame = CGRect(x: 0, y: 0, width: canvas.width, height: canvas.height * 0.20)
        top.colors = [UIColor.black.withAlphaComponent(0.42).cgColor, UIColor.clear.cgColor]
        top.startPoint = CGPoint(x: 0.5, y: 0)
        top.endPoint = CGPoint(x: 0.5, y: 1)
        container.addSublayer(top)

        let bottom = CAGradientLayer()
        bottom.frame = CGRect(x: 0, y: canvas.height * 0.70, width: canvas.width, height: canvas.height * 0.30)
        bottom.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.55).cgColor]
        bottom.startPoint = CGPoint(x: 0.5, y: 0)
        bottom.endPoint = CGPoint(x: 0.5, y: 1)
        container.addSublayer(bottom)

        let inset = (min(canvas.width, canvas.height) * 0.045).rounded()
        let border = max(2, 2.4 * s)
        let rect = CGRect(x: inset, y: inset, width: canvas.width - inset * 2, height: canvas.height - inset * 2)
        let framePath = roundRectFromTop(rect, radius: 18 * s)

        let frame = shapeLayer(framePath, frame: container.bounds)
        frame.strokeColor = palette.neutral.withAlphaComponent(0.85).cgColor
        frame.lineWidth = border
        frame.lineCap = .butt
        frame.strokeEnd = 0
        frame.add(track("strokeEnd", clock) { num(TM.easeInOutCubic(TM.ramp($0, 0.2, 1.3))) }, forKey: "e")
        container.addSublayer(frame)

        if tl.end != nil {
            let closing = shapeLayer(framePath, frame: container.bounds)
            closing.strokeColor = palette.accent.withAlphaComponent(0.95).cgColor
            closing.lineWidth = border * 1.6
            closing.lineCap = .butt
            closing.strokeEnd = 0
            closing.add(track("strokeEnd", clock) { num(TM.easeInOutCubic(TM.outro($0, tl, 1.4))) }, forKey: "e")
            container.addSublayer(closing)
        }

        // Kicker: the dot pops and pulses on cuts; the rule extends.
        let dot = pinnedLayer(UIBezierPath(
            ovalIn: CGRect(x: -6 * s, y: -6 * s, width: 12 * s, height: 12 * s)).cgPath,
            at: CGPoint(x: inset + 34 * s, y: inset + 42 * s))
        dot.fillColor = palette.accent.cgColor
        dot.add(track("transform", clock) { t in
            let k = CGFloat(max(0.0001, TM.easeOutBack(TM.ramp(t, 0.35, 0.45))
                * (1 + 0.6 * TM.beatEnvelope(t, tl.beats, 0.05, 0.45))))
            return transformValue(sx: k, sy: k)
        }, forKey: "t")
        container.addSublayer(dot)

        let rulePath = CGMutablePath()
        rulePath.move(to: CGPoint(x: inset + 52.5 * s, y: inset + 41.5 * s))
        rulePath.addLine(to: CGPoint(x: inset + 52.5 * s + 91 * s, y: inset + 41.5 * s))
        let rule = shapeLayer(rulePath, frame: container.bounds)
        rule.strokeColor = palette.accent.cgColor
        rule.lineWidth = 5 * s
        rule.lineCap = .round
        rule.strokeEnd = 0
        rule.add(track("strokeEnd", clock) { t in
            num(TM.clamp01((96 * TM.easeOutCubic(TM.ramp(t, 0.5, 0.6)) - 5) / 91))
        }, forKey: "e")
        container.addSublayer(rule)

        buildSceneCounter(root: root, canvas: canvas, s: s, inset: inset, palette: palette, tl: tl, clock: clock)
    }

    private static func twoDigits(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    private static func textImage(_ text: String, size: CGFloat, color: UIColor) -> (UIImage, CGSize) {
        let font = UIFont.systemFont(ofSize: size, weight: .heavy)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let measured = (text as NSString).size(withAttributes: attributes)
        let box = CGSize(width: ceil(measured.width) + 2, height: ceil(font.lineHeight) + 2)
        let renderer = UIGraphicsImageRenderer(size: box, format: transparentFormat())
        let image = renderer.image { _ in
            (text as NSString).draw(at: CGPoint(x: 1, y: 1), withAttributes: attributes)
        }
        return (image, CGSize(width: measured.width, height: box.height))
    }

    /// The "02 / 05" counter, top-right: numbers roll up on every cut. Text
    /// images live in the UNFLIPPED root, so positions are bottom-left based.
    private static func buildSceneCounter(
        root: CALayer, canvas: CGSize, s: CGFloat, inset: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        let scenes = tl.beats.count + 1
        guard scenes >= 2 else { return }
        let sd = Double(s)
        let size = 30 * s
        let font = UIFont.systemFont(ofSize: size, weight: .heavy)
        let right = canvas.width - inset - 34 * s
        let baseline = inset + 42 * s + size * 0.36
        func appear(_ t: Double) -> Double { TM.easeOutCubic(TM.ramp(t, 0.6, 0.5)) }
        func lift(_ t: Double) -> CGFloat { CGFloat((1 - appear(t)) * 12 * sd) }

        /// A text layer whose right edge is `rightX` and baseline `baseline` (top-left coords).
        func place(_ image: UIImage, _ measured: CGSize, rightX: CGFloat) -> CALayer {
            let layer = CALayer()
            layer.contents = image.cgImage
            layer.contentsScale = 1
            let topY = baseline - font.ascender - 1
            let x = rightX - measured.width - 1
            layer.frame = CGRect(x: x, y: canvas.height - topY - image.size.height,
                                 width: image.size.width, height: image.size.height)
            layer.opacity = 0
            root.addSublayer(layer)
            return layer
        }

        let (totalImage, totalSize) = textImage("/ \(twoDigits(scenes))", size: size,
                                                color: palette.neutral)
        let total = place(totalImage, totalSize, rightX: right)
        total.add(track("opacity", clock) { num(0.7 * appear($0)) }, forKey: "o")
        total.add(track("transform", clock) { transformValue(ty: -lift($0)) }, forKey: "t")
        let numberRight = right - totalSize.width - 10 * s

        for k in 0..<scenes {
            let (image, measured) = textImage(twoDigits(k + 1), size: size, color: .white)
            let layer = place(image, measured, rightX: numberRight)
            func roll(_ t: Double) -> (Double, Double) {
                var dy = 0.0
                var alpha = 1.0
                if k > 0 {
                    let e = TM.easeOutCubic(TM.ramp(t, tl.beats[k - 1] - 0.12, 0.35))
                    dy += (1 - e) * 18 * sd
                    alpha *= e
                }
                if k < tl.beats.count {
                    let e = TM.easeOutCubic(TM.ramp(t, tl.beats[k] - 0.12, 0.35))
                    dy -= e * 18 * sd
                    alpha *= 1 - e
                }
                return (dy, alpha)
            }
            layer.add(track("opacity", clock) { num(roll($0).1 * appear($0)) }, forKey: "o")
            // Down is +y in the reference; this layer's space is y-up.
            layer.add(track("transform", clock) { t in
                transformValue(ty: -(lift(t) + CGFloat(roll(t).0)))
            }, forKey: "t")
        }
    }

    // MARK: bold_pop

    private static func buildBoldPop(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        let W = canvas.width
        let H = canvas.height
        let colors = [palette.primary, palette.secondary, palette.accent]
        let lengths: [CGFloat] = [300, 220, 150]

        // Stripes: each group's placement is baked into its paths; the slide
        // runs along the group's own axis.
        let groups: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (-80 * s, 210 * s, -CGFloat.pi / 4, 1),
            (W + 80 * s, H - 170 * s, CGFloat.pi * 3 / 4, 0.75),
        ]
        for (g, group) in groups.enumerated() {
            let (ox, oy, rot, sc) = group
            let place = CGAffineTransform(translationX: ox, y: oy).rotated(by: rot).scaledBy(x: sc, y: sc)
            let axis = CGPoint(x: cos(rot) * sc, y: sin(rot) * sc)
            for i in 0..<3 {
                let line = CGMutablePath()
                line.move(to: CGPoint(x: 0, y: CGFloat(i) * 30 * s), transform: place)
                line.addLine(to: CGPoint(x: lengths[i] * s, y: CGFloat(i) * 30 * s), transform: place)
                let layer = shapeLayer(line, frame: container.bounds)
                layer.strokeColor = colors[i].cgColor
                layer.lineWidth = 20 * s * sc
                layer.lineCap = .round
                layer.strokeEnd = 0
                layer.opacity = 0
                func drawOn(_ t: Double) -> Double {
                    TM.easeOutCubic(TM.ramp(t, 0.05 + 0.09 * Double(i) + 0.12 * Double(g), 0.5))
                }
                layer.add(track("strokeEnd", clock) { num(drawOn($0)) }, forKey: "e")
                layer.add(track("opacity", clock) { num(drawOn($0) > 0 ? 1 : 0) }, forKey: "o")
                layer.add(track("transform", clock) { t in
                    let slide = CGFloat((12 * TM.wave(t, 3.2, Double(i) * 0.18) * TM.ramp(t, 0.8, 0.5)
                        + 26 * TM.beatEnvelope(t, tl.beats, 0.06, 0.4)) * Double(s))
                    return transformValue(tx: axis.x * slide, ty: axis.y * slide)
                }, forKey: "t")
                container.addSublayer(layer)
            }
        }

        // Confetti; the last second gets one extra pop.
        var confettiBeats = tl.beats
        if let end = tl.end, end > 2 { confettiBeats.append(end - 1) }
        let u = s * 1.4
        let confetti: [(CGFloat, CGFloat, String, UIColor, Double)] = [
            (0.86, 0.2, "ring", palette.accent, 0),
            (0.08, 0.36, "plus", palette.secondary, 20),
            (0.9, 0.52, "triangle", palette.primary, 40),
            (0.14, 0.62, "dot", palette.secondary, 0),
            (0.8, 0.7, "zigzag", palette.accent, 80),
        ]
        for (k, c) in confetti.enumerated() {
            let (fx, fy, kind, color, baseRotation) = c
            let path = CGMutablePath()
            switch kind {
            case "ring":
                path.addEllipse(in: CGRect(x: -16 * u, y: -16 * u, width: 32 * u, height: 32 * u))
            case "dot":
                path.addEllipse(in: CGRect(x: -9 * u, y: -9 * u, width: 18 * u, height: 18 * u))
            case "plus":
                path.move(to: CGPoint(x: -18 * u, y: 0))
                path.addLine(to: CGPoint(x: 18 * u, y: 0))
                path.move(to: CGPoint(x: 0, y: -18 * u))
                path.addLine(to: CGPoint(x: 0, y: 18 * u))
            case "triangle":
                let r = 18 * u
                path.move(to: CGPoint(x: 0, y: -r))
                path.addLine(to: CGPoint(x: r * 0.866, y: r * 0.5))
                path.addLine(to: CGPoint(x: -r * 0.866, y: r * 0.5))
                path.closeSubpath()
            default:
                path.move(to: CGPoint(x: -20 * u, y: 5 * u))
                path.addLine(to: CGPoint(x: -10 * u, y: -5 * u))
                path.addLine(to: CGPoint(x: 0, y: 5 * u))
                path.addLine(to: CGPoint(x: 10 * u, y: -5 * u))
                path.addLine(to: CGPoint(x: 20 * u, y: 5 * u))
            }
            let layer = pinnedLayer(path, at: CGPoint(x: W * fx, y: H * fy))
            if kind == "dot" {
                layer.fillColor = color.cgColor
            } else {
                layer.strokeColor = color.cgColor
                layer.lineWidth = (kind == "plus" ? 8 : 6) * s
                layer.lineCap = .round
                layer.lineJoin = .round
            }
            layer.add(track("transform", clock) { t in
                let scale = max(0.0001, TM.easeOutBack(TM.ramp(t, 0.35 + 0.08 * Double(k), 0.45))
                    + 0.35 * TM.beatEnvelope(t, confettiBeats, 0.05, 0.4))
                let dy = CGFloat(8 * Double(s) * TM.wave(t, 2.6, Double(k) * 0.21))
                let rot = CGFloat((baseRotation + 15 * TM.wave(t, 5, Double(k) * 0.13)) * Double.pi / 180)
                return transformValue(ty: dy, rotate: rot, sx: CGFloat(scale), sy: CGFloat(scale))
            }, forKey: "t")
            container.addSublayer(layer)
        }

        // The bottom progress line with its leading dot.
        if tl.end != nil {
            func appear(_ t: Double) -> Double { TM.easeOutCubic(TM.ramp(t, 0.2, 0.5)) }
            let y = H - 6 * s
            let trackLayer = CALayer()
            trackLayer.frame = CGRect(x: 0, y: y - 6 * s, width: W, height: 12 * s)
            trackLayer.backgroundColor = UIColor.black.cgColor
            trackLayer.opacity = 0
            trackLayer.add(track("opacity", clock) { num(0.25 * appear($0)) }, forKey: "o")
            container.addSublayer(trackLayer)

            let fillLayer = CALayer()
            fillLayer.anchorPoint = CGPoint(x: 0, y: 0.5)
            fillLayer.bounds = CGRect(x: 0, y: 0, width: W, height: 12 * s)
            fillLayer.position = CGPoint(x: 0, y: y)
            fillLayer.backgroundColor = palette.accent.cgColor
            fillLayer.opacity = 0
            fillLayer.add(track("opacity", clock) { num(appear($0)) }, forKey: "o")
            fillLayer.add(track("transform", clock) { t in
                transformValue(sx: CGFloat(max(0.0001, TM.videoProgress(t, tl))))
            }, forKey: "t")
            container.addSublayer(fillLayer)

            let dot = pinnedLayer(UIBezierPath(
                ovalIn: CGRect(x: -10 * s, y: -10 * s, width: 20 * s, height: 20 * s)).cgPath,
                at: CGPoint(x: 0, y: y))
            dot.fillColor = palette.secondary.cgColor
            dot.add(track("transform", clock) { t in
                let k = CGFloat(max(0.0001, (1 + 0.3 * TM.beatEnvelope(t, tl.beats, 0.05, 0.4)) * appear(t)))
                return transformValue(tx: W * CGFloat(TM.videoProgress(t, tl)), sx: k, sy: k)
            }, forKey: "t")
            container.addSublayer(dot)
        }

        // The slanted colour wipe across every cut.
        if !tl.beats.isEmpty {
            let shear = 0.12 * H
            let bw = 0.2 * W
            func band(_ offset: CGFloat, _ width: CGFloat, _ color: UIColor) {
                let p = CGMutablePath()
                p.move(to: CGPoint(x: offset - width / 2 + shear, y: 0))
                p.addLine(to: CGPoint(x: offset + width / 2 + shear, y: 0))
                p.addLine(to: CGPoint(x: offset + width / 2 - shear, y: H))
                p.addLine(to: CGPoint(x: offset - width / 2 - shear, y: H))
                p.closeSubpath()
                let layer = shapeLayer(p, frame: container.bounds)
                layer.fillColor = color.cgColor
                layer.opacity = 0
                layer.add(track("opacity", clock) { t in
                    num(TM.beatProgress(t, tl.beats, 0.22, 0.44) >= 0 ? 1 : 0)
                }, forKey: "o")
                layer.add(track("transform", clock) { t in
                    let p = TM.beatProgress(t, tl.beats, 0.22, 0.44)
                    let cx = -0.35 * W + 1.7 * W * CGFloat(TM.easeInOutCubic(max(0, p)))
                    return transformValue(tx: cx)
                }, forKey: "t")
                container.addSublayer(layer)
            }
            band(-bw * 0.95, bw * 0.35, palette.secondary.withAlphaComponent(0.9))
            band(0, bw, palette.accent.withAlphaComponent(0.92))
        }
    }

    // MARK: cinematic

    private static func buildCinematic(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette,
        tl: TemplateTimeline, clock: TemplateClock
    ) {
        let W = canvas.width
        let H = canvas.height
        let reach = hypot(W / 2, H / 2)

        // Light leak: a radial wash drifting slowly, under everything else.
        let R = 0.7 * max(W, H)
        let leak = CAGradientLayer()
        leak.type = .radial
        leak.bounds = CGRect(x: 0, y: 0, width: R * 2, height: R * 2)
        leak.colors = [palette.secondary.cgColor,
                       palette.secondary.withAlphaComponent(0.35).cgColor,
                       palette.secondary.withAlphaComponent(0).cgColor]
        leak.locations = [0, 0.5, 1]
        leak.startPoint = CGPoint(x: 0.5, y: 0.5)
        leak.endPoint = CGPoint(x: 1, y: 1)
        leak.opacity = 0
        func leakAt(_ t: Double) -> CGPoint {
            CGPoint(x: W * CGFloat(0.85 - 0.35 * (0.5 + 0.5 * TM.wave(t, 11))),
                    y: H * CGFloat(0.08 + 0.12 * (0.5 + 0.5 * TM.wave(t, 11, 0.25))))
        }
        leak.position = leakAt(0)
        leak.add(track("position", clock) { NSValue(cgPoint: leakAt($0)) }, forKey: "p")
        leak.add(track("opacity", clock) { t in
            num((0.22 + 0.08 * TM.wave(t, 5.5)) * TM.ramp(t, 0.3, 1.2))
        }, forKey: "o")
        container.addSublayer(leak)

        // Vignette.
        let vignette = CAGradientLayer()
        vignette.type = .radial
        vignette.bounds = CGRect(x: 0, y: 0, width: reach * 2, height: reach * 2)
        vignette.position = CGPoint(x: W / 2, y: H / 2)
        vignette.colors = [UIColor.clear.cgColor, UIColor.clear.cgColor,
                           UIColor.black.withAlphaComponent(0.42).cgColor]
        vignette.locations = [0, 0.45, 1]
        vignette.startPoint = CGPoint(x: 0.5, y: 0.5)
        vignette.endPoint = CGPoint(x: 1, y: 1)
        container.addSublayer(vignette)

        // The anamorphic flare across every cut.
        if !tl.beats.isEmpty {
            func flare(_ t: Double) -> (Double, CGFloat) {
                let p = TM.beatProgress(t, tl.beats, 0.25, 0.75)
                guard p >= 0 else { return (0, W * 0.35) }
                return (sin(Double.pi * p), W * CGFloat(0.35 + 0.3 * p))
            }
            let cy = H * 0.42

            let flash = CALayer()
            flash.frame = container.bounds
            flash.backgroundColor = UIColor.white.cgColor
            flash.opacity = 0
            flash.add(track("opacity", clock) { num(0.08 * flare($0).0) }, forKey: "o")
            container.addSublayer(flash)

            let glow = CAGradientLayer()
            glow.type = .radial
            glow.bounds = CGRect(x: 0, y: 0, width: W * 1.1, height: 140 * s)
            glow.colors = [palette.accent.cgColor, palette.accent.withAlphaComponent(0).cgColor]
            glow.startPoint = CGPoint(x: 0.5, y: 0.5)
            glow.endPoint = CGPoint(x: 1, y: 1)
            glow.position = CGPoint(x: W * 0.35, y: cy)
            glow.opacity = 0
            glow.add(track("opacity", clock) { num(0.45 * flare($0).0) }, forKey: "o")
            glow.add(track("position", clock) { NSValue(cgPoint: CGPoint(x: flare($0).1, y: cy)) }, forKey: "p")
            container.addSublayer(glow)

            let core = CAGradientLayer()
            core.bounds = CGRect(x: 0, y: 0, width: W * 0.9, height: 3 * s)
            core.colors = [UIColor.white.withAlphaComponent(0).cgColor, UIColor.white.cgColor,
                           UIColor.white.withAlphaComponent(0).cgColor]
            core.startPoint = CGPoint(x: 0, y: 0.5)
            core.endPoint = CGPoint(x: 1, y: 0.5)
            core.position = CGPoint(x: W * 0.35, y: cy)
            core.opacity = 0
            core.add(track("opacity", clock) { num(0.9 * flare($0).0) }, forKey: "o")
            core.add(track("position", clock) { NSValue(cgPoint: CGPoint(x: flare($0).1, y: cy)) }, forKey: "p")
            container.addSublayer(core)
        }

        // The end darkens under the closing bars.
        if tl.end != nil {
            let dim = CALayer()
            dim.frame = container.bounds
            dim.backgroundColor = UIColor.black.cgColor
            dim.opacity = 0
            dim.add(track("opacity", clock) { num(0.22 * TM.easeInOutCubic(TM.outro($0, tl, 1.4))) }, forKey: "o")
            container.addSublayer(dim)
        }

        // Letterbox bars: each a full-height-of-travel black slab slid into
        // place; the accent hairline rides its inner edge.
        let barH: CGFloat = H / W >= 1.5 ? 0.06 * H : (W / H > 1.5 ? 0.1 * H : 0.075 * H)
        let slab = barH * 1.4 + 2
        func bar(_ t: Double) -> CGFloat {
            barH * CGFloat(TM.easeOutCubic(TM.ramp(t, 0, 0.9)))
                + 0.4 * barH * CGFloat(TM.easeInOutCubic(TM.outro(t, tl, 1.4)))
        }
        let lineH = max(1.5, 2 * s)
        for top in [true, false] {
            let slabLayer = CALayer()
            slabLayer.frame = top
                ? CGRect(x: 0, y: -slab, width: W, height: slab)
                : CGRect(x: 0, y: H, width: W, height: slab)
            slabLayer.backgroundColor = UIColor.black.cgColor
            slabLayer.add(track("transform", clock) { t in
                transformValue(ty: top ? bar(t) : -bar(t))
            }, forKey: "t")
            container.addSublayer(slabLayer)

            let hairline = CALayer()
            hairline.bounds = CGRect(x: 0, y: 0, width: W, height: lineH)
            hairline.position = top
                ? CGPoint(x: W / 2, y: slab - lineH / 2)
                : CGPoint(x: W / 2, y: lineH / 2)
            hairline.backgroundColor = palette.accent.withAlphaComponent(0.85).cgColor
            hairline.add(track("transform", clock) { t in
                transformValue(sx: CGFloat(max(0.0001, TM.easeInOutCubic(TM.ramp(t, 0.7, 0.9)))))
            }, forKey: "t")
            slabLayer.addSublayer(hairline)
        }
    }

    // ── template helpers ────────────────────────────────────────────────────

    /// The composition's concave four-point sparkle.
    private static func star4(center c: CGPoint, r: CGFloat) -> CGPath {
        let i = r * 0.24
        let path = CGMutablePath()
        path.move(to: CGPoint(x: c.x, y: c.y - r))
        path.addCurve(to: CGPoint(x: c.x + r, y: c.y), control1: CGPoint(x: c.x + i, y: c.y - i),
                      control2: CGPoint(x: c.x + i, y: c.y - i))
        path.addCurve(to: CGPoint(x: c.x, y: c.y + r), control1: CGPoint(x: c.x + i, y: c.y + i),
                      control2: CGPoint(x: c.x + i, y: c.y + i))
        path.addCurve(to: CGPoint(x: c.x - r, y: c.y), control1: CGPoint(x: c.x - i, y: c.y + i),
                      control2: CGPoint(x: c.x - i, y: c.y + i))
        path.addCurve(to: CGPoint(x: c.x, y: c.y - r), control1: CGPoint(x: c.x - i, y: c.y - i),
                      control2: CGPoint(x: c.x - i, y: c.y - i))
        path.closeSubpath()
        return path
    }

    /// Path length by flattening curves into short segments — enough precision
    /// to time a draw-on stroke.
    static func approximateLength(_ path: CGPath) -> CGFloat {
        var length: CGFloat = 0
        var current = CGPoint.zero
        var start = CGPoint.zero
        path.applyWithBlock { element in
            let points = element.pointee.points
            switch element.pointee.type {
            case .moveToPoint:
                current = points[0]
                start = current
            case .addLineToPoint:
                length += hypot(points[0].x - current.x, points[0].y - current.y)
                current = points[0]
            case .addQuadCurveToPoint:
                var previous = current
                for step in 1...16 {
                    let t = CGFloat(step) / 16
                    let x = (1 - t) * (1 - t) * current.x + 2 * (1 - t) * t * points[0].x + t * t * points[1].x
                    let y = (1 - t) * (1 - t) * current.y + 2 * (1 - t) * t * points[0].y + t * t * points[1].y
                    length += hypot(x - previous.x, y - previous.y)
                    previous = CGPoint(x: x, y: y)
                }
                current = points[1]
            case .addCurveToPoint:
                var previous = current
                for step in 1...16 {
                    let t = CGFloat(step) / 16
                    let a = (1 - t) * (1 - t) * (1 - t)
                    let b = 3 * (1 - t) * (1 - t) * t
                    let c = 3 * (1 - t) * t * t
                    let d = t * t * t
                    let x = a * current.x + b * points[0].x + c * points[1].x + d * points[2].x
                    let y = a * current.y + b * points[0].y + c * points[1].y + d * points[2].y
                    length += hypot(x - previous.x, y - previous.y)
                    previous = CGPoint(x: x, y: y)
                }
                current = points[2]
            case .closeSubpath:
                length += hypot(start.x - current.x, start.y - current.y)
                current = start
            @unknown default:
                break
            }
        }
        return length
    }

    private struct Palette {
        let primary: UIColor
        let secondary: UIColor
        let accent: UIColor
        let neutral: UIColor

        init(_ source: RenderManifest.Palette) {
            primary = Palette.color(source.primary)
            secondary = Palette.color(source.secondary)
            accent = Palette.color(source.accent)
            neutral = Palette.color(source.neutral)
        }

        static func color(_ hex: String) -> UIColor {
            var value: UInt64 = 0
            Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        }
    }

    static func transparentFormat() -> UIGraphicsImageRendererFormat {
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        format.scale = 1
        // ROOT CAUSE of the unreadable captions: on wide-colour iPhones/iPads
        // `.default()` picks the EXTENDED range — a 16-bit half-float bitmap.
        // `AVVideoCompositionCoreAnimationTool`'s offscreen renderer does not
        // read that layer content correctly, so solid white glyphs came out
        // near-black and only the anti-aliased edges showed, as a grey fringe.
        // Force a plain 8-bit sRGB bitmap, which the export reads exactly.
        format.preferredRange = .standard
        return format
    }
}

// MARK: - Text graphics

/// Builds the scene-matched text graphics (hook, scene labels with badges,
/// closing card) as a Core Animation layer tree for
/// `AVVideoCompositionCoreAnimationTool`, in the pack's frame (card, none,
/// post-it, painting, ribbon, bubble), text effect (plain, shadow, outline,
/// glow) and position.
///
/// THE REFERENCE IS `src/lib/textGraphics/` — `layout.ts` for every box and
/// position, `motion.ts` for every curve, `canvasRenderer.ts` for every paint,
/// which is the preview the requester chose from. Layout is done in TOP-LEFT
/// frame pixels exactly as there; each box is then placed in Core Animation's
/// bottom-left space, where a vertical move and a rotation change sign. Every
/// curve is sampled into linear keyframes from the same formulas.
enum TextGraphicsLayers {

    final class Node {
        var x: CGFloat = 0, y: CGFloat = 0, w: CGFloat = 0, h: CGFloat = 0
        /// "l" left-centre, "c" centre, "t" top-centre.
        var anchor = "l"
        var anim: Anim?
        var idle: Idle?
        var rotate: CGFloat = 0
        var paint: Paint = .none
        var children: [Node] = []
    }

    struct Anim {
        let kind: String
        let delay: Double
        let dur: Double
    }

    struct Idle {
        let kind: String
        let amp: Double
        let period: Double
    }

    struct Panel {
        let frame: String
        let color: UIColor
        let radius: CGFloat
        let shadowDx: CGFloat
        let shadowDy: CGFloat
        let shadow: UIColor
        let frameColor: UIColor
        let frameInner: UIColor
        let frameAccent: UIColor
        let frameMat: UIColor
        let tape: UIColor
        let frameWidth: CGFloat
        let s: CGFloat
    }

    struct TextEffect {
        let kind: String
        let color: UIColor
        let blur: CGFloat
        let dy: CGFloat
        let width: CGFloat

        static let plain = TextEffect(kind: "plain", color: .clear, blur: 0, dy: 0, width: 0)
    }

    enum Paint {
        case none
        case box(color: UIColor, radius: CGFloat, shadowDx: CGFloat, shadowDy: CGFloat, shadow: UIColor)
        case panel(Panel)
        case text(text: String, font: UIFont, color: UIColor, ascent: CGFloat, effect: TextEffect)
        case dot(color: UIColor)
        case pin(color: UIColor)
        case badge(shape: String, bg: UIColor, ring: UIColor, text: String, font: UIFont,
                   color: UIColor, ascent: CGFloat, descent: CGFloat)
    }

    struct ItemLayout {
        let item: TextGraphicsSpec.Item
        let pivotX: CGFloat
        let pivotY: CGFloat
        let nodes: [Node]
    }

    // MARK: Spec access

    private struct Context {
        let spec: TextGraphicsSpec
        let canvas: CGSize
        let s: CGFloat
        let accent: UIColor
        let descriptors: [String: CTFontDescriptor]

        var shape: TextGraphicsSpec.Shape { spec.style.shape }
        var frame: String { shape.frame ?? "card" }

        func size(_ name: String, _ fallback: Double) -> CGFloat {
            CGFloat(spec.style.sizes[name] ?? fallback)
        }

        func color(_ name: String) -> UIColor {
            resolve(spec.style.colors[name] ?? "#00000000")
        }

        func resolve(_ raw: String) -> UIColor {
            raw == "accent" ? accent : TextGraphicsLayers.parseColor(raw) ?? .clear
        }

        func anim(_ name: String) -> Anim? {
            guard let entry = spec.style.motion[name], let kind = entry.kind else { return nil }
            return Anim(kind: kind, delay: entry.delay ?? 0, dur: entry.dur ?? 0.3)
        }

        func idle(_ name: String) -> Idle? {
            guard let entry = spec.style.motion[name], let kind = entry.kind, kind != "none" else { return nil }
            return Idle(kind: kind, amp: entry.amp ?? 0, period: entry.period ?? 0)
        }

        func fontKey(_ role: String) -> String { spec.style.fonts[role] ?? "" }

        func font(_ key: String, _ size: CGFloat) -> UIFont {
            if let descriptor = descriptors[key] {
                return CTFontCreateWithFontDescriptor(descriptor, size, nil) as UIFont
            }
            return UIFont.systemFont(ofSize: size, weight: .heavy)
        }

        func ascent(_ key: String) -> CGFloat {
            CGFloat(spec.fonts.first(where: { $0.key == key })?.ascent ?? 1.0)
        }

        func descent(_ key: String) -> CGFloat {
            CGFloat(spec.fonts.first(where: { $0.key == key })?.descent ?? 0.3)
        }

        func lineHeight(_ key: String, _ size: CGFloat) -> CGFloat {
            size * (ascent(key) + descent(key))
        }

        func measure(_ text: String, _ key: String, _ size: CGFloat) -> CGFloat {
            (text as NSString).size(withAttributes: [.font: font(key, size)]).width
        }

        func fitSize(_ text: String, _ key: String, _ size: CGFloat, _ maxWidth: CGFloat,
                     _ minFactor: CGFloat = 0.6) -> CGFloat {
            let w = measure(text, key, size)
            if w <= maxWidth || w <= 0 { return size }
            return max(size * minFactor, size * maxWidth / w)
        }

        var safeTop: CGFloat {
            canvas.height / canvas.width >= 1.5
                ? 0.11 * canvas.height
                : max(56 * s, 0.06 * canvas.height)
        }

        /// `textEffectFor` in layout.ts.
        func textEffect(_ size: CGFloat) -> TextEffect {
            let effectColor = color("textEffect")
            switch shape.textEffect ?? "plain" {
            case "shadow": return TextEffect(kind: "shadow", color: effectColor, blur: 12 * s, dy: 3 * s, width: 0)
            case "outline": return TextEffect(kind: "outline", color: effectColor, blur: 0, dy: 0, width: max(3 * s, size * 0.12))
            case "glow": return TextEffect(kind: "glow", color: effectColor, blur: size * 0.45, dy: 0, width: 0)
            case "marker":
                // Highlighter behind big words; small words get a soft dark shadow.
                return size >= 40 * s
                    ? TextEffect(kind: "marker", color: effectColor, blur: 8 * s, dy: 2 * s, width: 10 * s)
                    : TextEffect(kind: "shadow", color: UIColor(white: 0, alpha: 0xB0 / 255), blur: 8 * s, dy: 2 * s, width: 0)
            default: return .plain
            }
        }

        /// `basePadding` in layout.ts: (left, right, top, bottom).
        func padding(_ l: CGFloat, _ r: CGFloat, _ t: CGFloat, _ b: CGFloat)
            -> (CGFloat, CGFloat, CGFloat, CGFloat) {
            if frame == "none" { return (0, 0, 0, 0) }
            let fw = CGFloat(shape.frameWidth ?? 0) * s
            var extra: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
            switch frame {
            case "painting": extra = (fw + 12 * s, fw + 12 * s, fw + 12 * s, fw + 12 * s)
            case "ribbon", "slant": extra = (fw, fw, 0, 0)
            case "postit": extra = (6 * s, 6 * s, 18 * s, 6 * s)
            default: break
            }
            return (l * s + extra.0, r * s + extra.1, t * s + extra.2, b * s + extra.3)
        }

        /// `panelPaint` in layout.ts.
        func panel(_ colorName: String) -> Panel {
            Panel(
                frame: frame,
                color: color(colorName),
                radius: CGFloat(shape.cardRadius ?? 16) * s,
                shadowDx: CGFloat(shape.shadowDx ?? 0) * s,
                shadowDy: CGFloat(shape.shadowDy ?? 0) * s,
                shadow: color("shadow"),
                frameColor: color("frame"),
                frameInner: color("frameInner"),
                frameAccent: color("frameAccent"),
                frameMat: color("frameMat"),
                tape: color("tape"),
                frameWidth: CGFloat(shape.frameWidth ?? 0) * s,
                s: s)
        }
    }

    static func parseColor(_ hex: String) -> UIColor? {
        guard hex.hasPrefix("#") else { return nil }
        let body = String(hex.dropFirst())
        guard body.count == 6 || body.count == 8, let value = UInt64(body, radix: 16) else { return nil }
        let rgb = body.count == 8 ? value >> 8 : value
        let alpha = body.count == 8 ? CGFloat(value & 0xFF) / 255 : 1
        return UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: alpha)
    }

    private static func alphaOf(_ color: UIColor) -> CGFloat {
        var alpha: CGFloat = 0
        _ = color.getRed(nil, green: nil, blue: nil, alpha: &alpha)
        return alpha
    }

    private static func loadDescriptors(_ files: [String: URL]) -> [String: CTFontDescriptor] {
        var out: [String: CTFontDescriptor] = [:]
        for (key, url) in files {
            if let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
               let first = descriptors.first {
                out[key] = first
            }
        }
        return out
    }

    // MARK: Layout (layout.ts)

    private static func textNode(_ c: Context, _ text: String, _ key: String, _ size: CGFloat,
                                 _ color: UIColor, _ x: CGFloat, _ y: CGFloat, _ anim: Anim?,
                                 effect: Bool = false) -> Node {
        let n = Node()
        n.x = x
        n.y = y
        n.w = c.measure(text, key, size)
        n.h = c.lineHeight(key, size)
        n.anim = anim
        n.paint = .text(text: text, font: c.font(key, size), color: color, ascent: c.ascent(key) * size,
                        effect: effect ? c.textEffect(size) : .plain)
        return n
    }

    private static func boxNode(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: UIColor,
                                _ radius: CGFloat, _ anim: Anim?, shadowDx: CGFloat = 0, shadowDy: CGFloat = 0,
                                shadow: UIColor = .clear) -> Node {
        let n = Node()
        n.x = x
        n.y = y
        n.w = w
        n.h = h
        n.anim = anim
        n.paint = .box(color: color, radius: radius, shadowDx: shadowDx, shadowDy: shadowDy, shadow: shadow)
        return n
    }

    private static let positions: Set<String> = ["top-left", "top-center", "top-right", "middle-left", "middle-right"]

    private static func shift(_ n: Node, _ dx: CGFloat, _ dy: CGFloat) {
        n.x += dx
        n.y += dy
        for child in n.children { shift(child, dx, dy) }
    }

    /// `place` in layout.ts.
    private static func place(_ c: Context, _ item: TextGraphicsSpec.Item, _ nodes: [Node]) -> ItemLayout {
        // A hung painting's wire and nail rise 44 px above the frame: keep them on screen.
        let extraTop: CGFloat = c.frame == "painting" && item.kind != "cta" ? 50 * c.s : 0
        let top = c.safeTop + extraTop
        let wanted = item.position ?? ""
        var position = positions.contains(wanted) ? wanted : (c.spec.style.positions?[item.kind] ?? "top-left")
        if !positions.contains(position) { position = "top-left" }

        var x0 = CGFloat.greatestFiniteMagnitude, y0 = CGFloat.greatestFiniteMagnitude
        var x1 = -CGFloat.greatestFiniteMagnitude, y1 = -CGFloat.greatestFiniteMagnitude
        for n in nodes {
            x0 = min(x0, n.x)
            y0 = min(y0, n.y)
            x1 = max(x1, n.x + n.w)
            y1 = max(y1, n.y + n.h)
        }
        let bw = x1 - x0
        let bh = y1 - y0
        let M = 64 * c.s
        let isTop = position.hasPrefix("top")
        let col = position.hasSuffix("left") ? "left" : position.hasSuffix("right") ? "right" : "center"
        let x = col == "left" ? M : col == "right" ? c.canvas.width - M - bw : (c.canvas.width - bw) / 2
        let y = isTop ? top : max(top, 0.42 * c.canvas.height - bh / 2)
        for n in nodes { shift(n, x - x0, y - y0) }
        let centred = col == "center" || item.kind == "cta"
        return ItemLayout(
            item: item,
            pivotX: centred ? x + bw / 2 : col == "right" ? x + bw : x,
            pivotY: centred ? y + bh / 2 : y,
            nodes: nodes)
    }

    private static func layoutLabel(_ c: Context, _ item: TextGraphicsSpec.Item) -> [Node] {
        let s = c.s
        let shape = c.shape
        let M = 64 * s
        let top = c.safeTop
        let hasBadge = !item.badge.isEmpty
        let D = c.size("badgeDiameter", 150) * s
        let barW = CGFloat(shape.barWidth ?? 0) * s
        let barGap: CGFloat = barW > 0 ? 14 * s : 0
        let (padL, padR, padT, padB) = c.padding(26, 30, 16, 20)

        let maxText = c.canvas.width - 2 * M - barW - barGap - padL - padR - (hasBadge ? 0.9 * D : 0)
        let titleFont = c.fontKey("title")
        let bodyFont = c.fontKey("body")
        let titleSize = c.fitSize(item.title, titleFont, c.size("title", 60) * s, maxText)
        let sub = (shape.uppercaseSub ?? false) ? item.sub.uppercased() : item.sub
        let subSize = c.fitSize(sub, bodyFont, c.size("sub", 28) * s, maxText)
        let numSize = c.size("num", 28) * s

        let cardX = M + barW + barGap
        let innerX = cardX + padL
        var y = top + padT
        var children: [Node] = []

        if !item.num.isEmpty {
            let n = textNode(c, item.num, titleFont, numSize, c.color("num"), innerX, y, c.anim("num"), effect: true)
            children.append(n)
            y += n.h + 2 * s
        }
        let title = textNode(c, item.title, titleFont, titleSize, c.color("title"), innerX, y, c.anim("title"), effect: true)
        children.append(title)
        y += title.h
        if shape.underline ?? false {
            y += 4 * s
            children.append(boxNode(innerX, y, title.w, 6 * s, c.color("underline"), 3 * s, c.anim("underline")))
            y += 6 * s + 8 * s
        } else {
            y += 4 * s
        }
        if !sub.isEmpty {
            let subNode = textNode(c, sub, bodyFont, subSize, c.color("sub"), innerX, y, c.anim("sub"), effect: true)
            children.append(subNode)
            y += subNode.h
        }
        let contentW = children.map { $0.w }.max() ?? 0
        let cardW = padL + contentW + padR
        let cardH = y + padB - top

        var nodes: [Node] = []
        if barW > 0 {
            let bar = boxNode(M, top, barW, cardH, c.color("bar"), barW / 2, c.anim("bar"))
            bar.anchor = "t"
            nodes.append(bar)
        }
        let card = Node()
        card.x = cardX
        card.y = top
        card.w = cardW
        card.h = cardH
        card.anim = c.anim("card")
        card.paint = .panel(c.panel("cardBg"))
        card.children = children
        nodes.append(card)

        if hasBadge {
            let badgeFont = c.fontKey("badge")
            let kind = shape.badge ?? "circle"
            let tag = kind == "tag"
            let bw = tag ? 1.4 * D : D
            let bh = tag ? 0.6 * D : D
            let overlap = c.frame == "none" ? -16 * s : 0.1 * bh
            let cx = cardX + cardW + bw / 2 - overlap
            let cy = top + 0.22 * D
            let textMax = (tag ? 1.15 : 0.66) * D
            let size = c.fitSize(item.badge, badgeFont, c.size("badgeText", 32) * s, textMax, 0.5)
            let badge = Node()
            badge.x = cx - bw / 2
            badge.y = cy - bh / 2
            badge.w = bw
            badge.h = bh
            badge.anchor = "c"
            badge.anim = c.anim("badge")
            badge.idle = c.idle("badgeIdle")
            badge.rotate = CGFloat(shape.badgeRotate ?? 0)
            badge.paint = .badge(shape: kind, bg: c.color("badgeBg"), ring: c.color("badgeRing"),
                                 text: item.badge, font: c.font(badgeFont, size), color: c.color("badgeText"),
                                 ascent: c.ascent(badgeFont) * size, descent: c.descent(badgeFont) * size)
            nodes.append(badge)
        }
        return nodes
    }

    private static func layoutHook(_ c: Context, _ item: TextGraphicsSpec.Item) -> [Node] {
        let s = c.s
        let shape = c.shape
        let M = 64 * s
        let top = c.safeTop
        let (padL, padR, padT, padB) = c.padding(22, 30, 16, 20)
        let hookDot = shape.hookDot ?? false
        let dotD: CGFloat = hookDot ? 44 * s : 0
        let dotGap: CGFloat = hookDot ? 18 * s : 0
        let font = c.fontKey("hook")
        let bodyFont = c.fontKey("body")
        let maxText = c.canvas.width - 2 * M - padL - padR

        let innerX = M + padL
        var y = top + padT
        var children: [Node] = []

        if !item.kicker.isEmpty {
            let kickerText = item.kicker.uppercased()
            let size = c.fitSize(kickerText, bodyFont, c.size("kicker", 24) * s, maxText - 28 * s)
            let label = textNode(c, kickerText, bodyFont, size, c.color("kickerText"), innerX + 14 * s, y + 6 * s, nil)
            let chip = boxNode(innerX, y, label.w + 28 * s, label.h + 12 * s, c.color("kickerBg"), 6 * s, c.anim("kicker"))
            chip.children = [label]
            children.append(chip)
            y += chip.h + 10 * s
        }

        let titleSize = c.fitSize(item.title, font, c.size("hookTitle", 70) * s, maxText - dotD - dotGap)
        let titleH = c.lineHeight(font, titleSize)
        let rowH = max(dotD, titleH)
        if dotD > 0 {
            let dot = Node()
            dot.x = innerX
            dot.y = y + (rowH - dotD) / 2
            dot.w = dotD
            dot.h = dotD
            dot.anchor = "c"
            dot.anim = c.anim("dot")
            dot.paint = .dot(color: c.color("dot"))
            children.append(dot)
        }
        children.append(textNode(c, item.title, font, titleSize, c.color("hookTitle"),
                                 innerX + dotD + dotGap, y + (rowH - titleH) / 2, c.anim("hookTitle"), effect: true))
        y += rowH + 4 * s

        if !item.sub.isEmpty {
            let size = c.fitSize(item.sub, bodyFont, c.size("hookSub", 34) * s, maxText)
            let sub = textNode(c, item.sub, bodyFont, size, c.color("hookSub"), innerX, y, c.anim("hookSub"), effect: true)
            children.append(sub)
            y += sub.h
        }

        let contentRight = children.map { $0.x + $0.w }.max() ?? innerX
        let box = Node()
        box.x = M
        box.y = top
        box.w = contentRight - M + padR
        box.h = y + padB - top
        box.anim = c.anim("hookBox")
        box.paint = .panel(c.panel("hookBg"))
        box.children = children
        return [box]
    }

    private static func layoutCta(_ c: Context, _ item: TextGraphicsSpec.Item) -> [Node] {
        let first = layoutCta(c, item, factor: 1)
        let maxW = c.canvas.width - 2 * 64 * c.s
        let w = first.first?.w ?? 0
        if w <= maxW { return first }
        return layoutCta(c, item, factor: max(0.55, maxW / w))
    }

    private static func layoutCta(_ c: Context, _ item: TextGraphicsSpec.Item, factor f: CGFloat) -> [Node] {
        let k = c.s * f
        let shape = c.shape
        let top = c.safeTop
        let padX = 22 * k, padY = 18 * k, pinSize = 72 * k, gap1 = 20 * k, gap2 = 26 * k
        let titleFont = c.fontKey("title")
        let bodyFont = c.fontKey("body")

        let brandSize = c.size("ctaBrand", 46) * k
        let placeSize = c.size("ctaPlace", 30) * k
        let buttonSize = c.size("ctaButton", 42) * k
        let hasBrand = !item.brand.isEmpty
        let hasPlace = !item.place.isEmpty
        let hasButton = !item.title.isEmpty
        let brandW = hasBrand ? c.measure(item.brand, titleFont, brandSize) : 0
        let placeW = hasPlace ? c.measure(item.place, bodyFont, placeSize) : 0
        let brandH = hasBrand ? c.lineHeight(titleFont, brandSize) : 0
        let placeH = hasPlace ? c.lineHeight(bodyFont, placeSize) : 0
        let colW = max(brandW, placeW)
        let colH = brandH + placeH
        let buttonTextW = hasButton ? c.measure(item.title, titleFont, buttonSize) : 0
        let buttonH = hasButton ? c.lineHeight(titleFont, buttonSize) + 24 * k : 0
        let buttonW = hasButton ? buttonTextW + 60 * k : 0

        let innerH = max(pinSize, max(colH, buttonH))
        let contentW = pinSize + (colW > 0 ? gap1 + colW : 0) + (buttonW > 0 ? gap2 + buttonW : 0)
        let cardW = padX * 2 + contentW
        let cardH = padY * 2 + innerH
        let cardX = 64 * c.s
        let cardY = top
        let midY = cardY + padY + innerH / 2

        var children: [Node] = []
        var x = cardX + padX
        let pin = Node()
        pin.x = x
        pin.y = midY - pinSize / 2
        pin.w = pinSize
        pin.h = pinSize
        pin.anchor = "c"
        pin.anim = c.anim("pin")
        pin.paint = .pin(color: c.color("pin"))
        children.append(pin)
        x += pinSize
        if colW > 0 {
            x += gap1
            var y = midY - colH / 2
            if hasBrand {
                children.append(textNode(c, item.brand, titleFont, brandSize, c.color("ctaBrand"), x, y, c.anim("ctaText")))
                y += brandH
            }
            if hasPlace {
                children.append(textNode(c, item.place, bodyFont, placeSize, c.color("ctaPlace"), x, y, c.anim("ctaText")))
            }
            x += colW
        }
        if buttonW > 0 {
            x += gap2
            let label = textNode(c, item.title, titleFont, buttonSize, c.color("buttonText"),
                                 x + 30 * k, midY - buttonH / 2 + 12 * k, nil)
            let button = boxNode(x, midY - buttonH / 2, buttonW, buttonH, c.color("buttonBg"), buttonH / 2, c.anim("button"))
            button.anchor = "c"
            button.idle = c.idle("buttonIdle")
            button.children = [label]
            children.append(button)
        }

        let card = boxNode(cardX, cardY, cardW, cardH, c.color("ctaBg"), CGFloat(shape.ctaRadius ?? 24) * k,
                           c.anim("ctaCard"), shadowDx: CGFloat(shape.shadowDx ?? 0) * k,
                           shadowDy: CGFloat(shape.shadowDy ?? 0) * k, shadow: c.color("shadow"))
        card.anchor = "c"
        card.children = children
        return [card]
    }

    // MARK: Motion (motion.ts)

    static func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }
    static func easeOutCubic(_ x: Double) -> Double { 1 - pow(1 - x, 3) }
    static func easeInCubic(_ x: Double) -> Double { x * x * x }
    static func easeBack(_ x: Double) -> Double {
        let c1 = 1.9
        let c3 = c1 + 1
        return 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2)
    }

    private static func ease(_ anim: Anim, _ p: Double) -> Double {
        anim.kind == "pop" || anim.kind == "drop" ? easeBack(p) : easeOutCubic(p)
    }

    // MARK: Layers

    /// The text-graphics layer tree for `canvas`, or nil when there is nothing to draw.
    static func build(_ spec: TextGraphicsSpec?, fonts: [String: URL], canvas: CGSize) -> CALayer? {
        guard let spec, !spec.items.isEmpty else { return nil }
        let context = Context(
            spec: spec,
            canvas: canvas,
            s: min(canvas.width, canvas.height) / 1080,
            accent: parseColor(spec.accent) ?? UIColor(red: 0xD7 / 255, green: 0x26 / 255, blue: 0x2E / 255, alpha: 1),
            descriptors: loadDescriptors(fonts))

        let root = CALayer()
        root.frame = CGRect(origin: .zero, size: canvas)
        var any = false
        for item in spec.items where item.end > item.start {
            let nodes: [Node]
            switch item.kind {
            case "hook": nodes = layoutHook(context, item)
            case "cta": nodes = layoutCta(context, item)
            case "label": nodes = layoutLabel(context, item)
            default: continue
            }
            root.addSublayer(itemLayer(context, place(context, item, nodes)))
            any = true
        }
        return any ? root : nil
    }

    private static func begin(_ seconds: Double) -> CFTimeInterval {
        AVCoreAnimationBeginTimeAtZero + seconds
    }

    /// A linear keyframe animation sampling `value` at `samples + 1` evenly
    /// spaced points of [begin, begin + duration].
    private static func sampled(_ keyPath: String, begin start: Double, duration: Double, samples: Int,
                                fill: CAMediaTimingFillMode = .both,
                                _ value: (Double) -> Any) -> CAKeyframeAnimation {
        let animation = CAKeyframeAnimation(keyPath: keyPath)
        var values: [Any] = []
        var times: [NSNumber] = []
        for k in 0...samples {
            let f = Double(k) / Double(samples)
            values.append(value(f))
            times.append(NSNumber(value: f))
        }
        animation.values = values
        animation.keyTimes = times
        animation.calculationMode = .linear
        animation.beginTime = begin(start)
        animation.duration = max(0.001, duration)
        animation.fillMode = fill
        animation.isRemovedOnCompletion = false
        return animation
    }

    private static func itemLayer(_ c: Context, _ layout: ItemLayout) -> CALayer {
        let W = c.canvas.width
        let H = c.canvas.height
        let s = c.s
        let item = layout.item
        let style = c.spec.style
        let exitEntry = style.motion["exit"]
        let exitKind = exitEntry?.kind ?? "fade"
        let exitDur = max(0, exitEntry?.dur ?? 0.3)
        let total = item.end - item.start

        let px = layout.pivotX
        let py = layout.pivotY

        let layer = CALayer()
        layer.bounds = CGRect(origin: .zero, size: c.canvas)
        layer.anchorPoint = CGPoint(x: px / W, y: 1 - py / H)
        layer.position = CGPoint(x: px, y: H - py)
        layer.opacity = 0

        // Visible from start to end, with the exit over the last `exitDur`.
        let exitFrom = total > 0 ? max(0, (total - exitDur) / total) : 0
        func exitProgress(_ f: Double) -> Double {
            guard f > exitFrom, exitDur > 0 else { return f >= 1 && exitDur <= 0 ? 1 : 0 }
            return clamp01((f * total - (total - exitDur)) / exitDur)
        }
        let samples = 48
        layer.add(sampled("opacity", begin: item.start, duration: total, samples: samples, fill: .forwards) { f in
            let o = exitProgress(f)
            let eo = easeInCubic(o)
            switch exitKind {
            case "slideLeft", "shrink": return NSNumber(value: Float(1 - eo))
            default: return NSNumber(value: Float(1 - o))
            }
        }, forKey: "tgVisible")
        if exitKind == "slideLeft" || exitKind == "shrink" {
            layer.add(sampled("transform", begin: item.start, duration: total, samples: samples, fill: .forwards) { f in
                let eo = CGFloat(easeInCubic(exitProgress(f)))
                let tx: CGFloat = exitKind == "slideLeft" ? -40 * eo * s : 0
                let sc: CGFloat = exitKind == "shrink" ? 1 - 0.15 * eo : 1
                return NSValue(caTransform3D: CATransform3DScale(CATransform3DMakeTranslation(tx, 0, 0), sc, sc, 1))
            }, forKey: "tgExit")
        }

        let tilt = CALayer()
        tilt.bounds = layer.bounds
        tilt.anchorPoint = layer.anchorPoint
        tilt.position = layer.position
        let tiltDeg = CGFloat(style.shape.tiltDeg ?? 0)
        if tiltDeg != 0 {
            tilt.transform = CATransform3DMakeRotation(-tiltDeg * .pi / 180, 0, 0, 1)
        }
        layer.addSublayer(tilt)

        for node in layout.nodes {
            tilt.addSublayer(nodeLayer(c, node, parentX: 0, parentY: 0, parentHeight: H, start: item.start))
        }
        return layer
    }

    private static func nodeLayer(_ c: Context, _ n: Node, parentX: CGFloat, parentY: CGFloat,
                                  parentHeight: CGFloat, start: Double) -> CALayer {
        let s = c.s
        let localX = n.x - parentX
        let localTop = n.y - parentY
        let originY = parentHeight - localTop - n.h

        let anchor: CGPoint
        switch n.anchor {
        case "c": anchor = CGPoint(x: 0.5, y: 0.5)
        case "t": anchor = CGPoint(x: 0.5, y: 1)
        default: anchor = CGPoint(x: 0, y: 0.5)
        }

        let enter = CALayer()
        enter.bounds = CGRect(x: 0, y: 0, width: n.w, height: n.h)
        enter.anchorPoint = anchor
        enter.position = CGPoint(x: localX + anchor.x * n.w, y: originY + anchor.y * n.h)

        let shift = CALayer()
        shift.frame = enter.bounds
        enter.addSublayer(shift)

        let idleLayer = CALayer()
        idleLayer.frame = enter.bounds
        shift.addSublayer(idleLayer)

        let content = CALayer()
        content.frame = enter.bounds
        if n.rotate != 0 {
            content.transform = CATransform3DMakeRotation(-n.rotate * .pi / 180, 0, 0, 1)
        }
        idleLayer.addSublayer(content)

        if let paintLayer = paintLayer(n, s: s) {
            content.addSublayer(paintLayer)
        }
        for child in n.children {
            content.addSublayer(nodeLayer(c, child, parentX: n.x, parentY: n.y, parentHeight: n.h, start: start))
        }

        if let anim = n.anim {
            addEnter(anim, to: enter, shift: shift, node: n, s: s, start: start)
        }
        if let idle = n.idle, idle.kind != "none", idle.period > 0 {
            addIdle(idle, to: idleLayer, after: start + max(1.0, (n.anim?.delay ?? 0) + (n.anim?.dur ?? 0)), s: s)
        }
        return enter
    }

    private static func addEnter(_ anim: Anim, to enter: CALayer, shift: CALayer, node n: Node,
                                 s: CGFloat, start: Double) {
        let from = start + anim.delay
        let dur = max(0.01, anim.dur)
        let samples = 16

        enter.add(sampled("opacity", begin: from, duration: dur, samples: samples) { p in
            if p <= 0 { return NSNumber(value: Float(0)) }
            switch anim.kind {
            case "pop", "drop": return NSNumber(value: Float(min(1, p * 4)))
            case "fade": return NSNumber(value: Float(ease(anim, p)))
            default: return NSNumber(value: Float(1))
            }
        }, forKey: "tgEnterOpacity")

        switch anim.kind {
        case "pop", "growX", "growY", "fade", "drop":
            enter.add(sampled("transform", begin: from, duration: dur, samples: samples) { p in
                let e = CGFloat(ease(anim, p))
                var ty: CGFloat = 0
                var sx: CGFloat = 1
                var sy: CGFloat = 1
                switch anim.kind {
                case "pop": sx = e; sy = e
                case "growX": sx = e
                case "growY": sy = e
                case "fade": ty = (1 - e) * 16 * s
                case "drop": ty = -(1 - e) * 40 * s
                default: break
                }
                // Canvas y points down; Core Animation's here points up.
                return NSValue(caTransform3D: CATransform3DScale(
                    CATransform3DMakeTranslation(0, -ty, 0), max(0.0001, sx), max(0.0001, sy), 1))
            }, forKey: "tgEnterTransform")
        case "rise":
            let mask = CALayer()
            mask.backgroundColor = UIColor.white.cgColor
            mask.frame = CGRect(x: -6 * s, y: -2 * s, width: n.w + 12 * s, height: n.h + 4 * s)
            enter.mask = mask
            shift.add(sampled("transform", begin: from, duration: dur, samples: samples) { p in
                let rise = (1 - CGFloat(ease(anim, p))) * 1.15 * n.h
                return NSValue(caTransform3D: CATransform3DMakeTranslation(0, -rise, 0))
            }, forKey: "tgRise")
        case "wipe":
            let fullWidth = 60 * s + n.w + 20 * s
            let mask = CALayer()
            mask.backgroundColor = UIColor.white.cgColor
            mask.anchorPoint = CGPoint(x: 0, y: 0.5)
            mask.bounds = CGRect(x: 0, y: 0, width: fullWidth, height: n.h + 1200 * s)
            mask.position = CGPoint(x: -60 * s, y: n.h / 2)
            enter.mask = mask
            mask.add(sampled("transform", begin: from, duration: dur, samples: samples) { p in
                let e = CGFloat(ease(anim, p))
                let k = (60 * s + (n.w + 20 * s) * e) / fullWidth
                return NSValue(caTransform3D: CATransform3DMakeScale(max(0.0001, k), 1, 1))
            }, forKey: "tgWipe")
        default:
            break
        }
    }

    private static func addIdle(_ idle: Idle, to layer: CALayer, after start: Double, s: CGFloat) {
        let keyPath: String
        switch idle.kind {
        case "wobble": keyPath = "transform.rotation.z"
        case "float": keyPath = "transform.translation.y"
        case "pulse": keyPath = "transform.scale"
        default: return
        }
        let animation = sampled(keyPath, begin: start, duration: idle.period, samples: 24, fill: .removed) { f in
            let wave = sin(2 * Double.pi * f)
            switch idle.kind {
            case "wobble": return NSNumber(value: -idle.amp * wave * Double.pi / 180)
            case "float": return NSNumber(value: -idle.amp * wave * Double(s))
            default: return NSNumber(value: 1 + idle.amp * wave)
            }
        }
        animation.repeatCount = .greatestFiniteMagnitude
        layer.add(animation, forKey: "tgIdle")
    }

    // MARK: Paint (canvasRenderer.ts)

    private static func paintLayer(_ n: Node, s: CGFloat) -> CALayer? {
        var margin: CGFloat = 4
        switch n.paint {
        case .none:
            return nil
        case let .box(_, _, dx, dy, _):
            margin = max(margin, abs(dx) + 2, abs(dy) + 2)
        case let .panel(panel):
            // Shadow offset, the bubble's tail and the post-it's tape reach outside the box.
            margin = max(margin, abs(panel.shadowDx) + 2, abs(panel.shadowDy) + 2, 56 * panel.s)
        case let .text(_, font, _, _, effect):
            margin = max(margin, font.pointSize * 0.4, effect.blur * 1.5 + abs(effect.dy), effect.width)
        case let .badge(_, _, _, _, font, _, _, _):
            margin = max(margin, font.pointSize * 0.4)
        default:
            break
        }
        let size = CGSize(width: max(1, n.w + 2 * margin), height: max(1, n.h + 2 * margin))
        let renderer = UIGraphicsImageRenderer(size: size, format: OverlayPainter.transparentFormat())
        let image = renderer.image { _ in
            let r = CGRect(x: margin, y: margin, width: n.w, height: n.h)
            draw(n.paint, in: r)
        }
        let layer = CALayer()
        layer.frame = CGRect(x: -margin, y: -margin, width: size.width, height: size.height)
        layer.contents = image.cgImage
        return layer
    }

    private static func roundRect(_ rect: CGRect, _ radius: CGFloat) -> UIBezierPath {
        let r = max(0, min(radius, rect.width / 2, rect.height / 2))
        return UIBezierPath(roundedRect: rect, cornerRadius: r)
    }

    /// `panelPath` in canvasRenderer.ts.
    private static func panelPath(_ p: Panel, _ r: CGRect) -> UIBezierPath {
        if p.frame == "slant" {
            let k = p.frameWidth
            let path = UIBezierPath()
            path.move(to: CGPoint(x: r.minX + k, y: r.minY))
            path.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            path.addLine(to: CGPoint(x: r.maxX - k, y: r.maxY))
            path.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            path.close()
            return path
        }
        if p.frame == "ribbon" {
            let notch = p.frameWidth
            let path = UIBezierPath()
            path.move(to: CGPoint(x: r.minX, y: r.minY))
            path.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            path.addLine(to: CGPoint(x: r.maxX - notch, y: r.midY))
            path.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            path.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            path.addLine(to: CGPoint(x: r.minX + notch, y: r.midY))
            path.close()
            return path
        }
        let path = roundRect(r, p.radius)
        if p.frame == "bubble" {
            let tail = UIBezierPath()
            tail.move(to: CGPoint(x: r.minX + 0.16 * r.width, y: r.maxY - 1))
            tail.addLine(to: CGPoint(x: r.minX + 0.16 * r.width + 40 * p.s, y: r.maxY - 1))
            tail.addLine(to: CGPoint(x: r.minX + 0.1 * r.width, y: r.maxY + 30 * p.s))
            tail.close()
            path.append(tail)
        }
        return path
    }

    /// `paintPainting` in canvasRenderer.ts: a painting hung on the wall.
    private static func drawPainting(_ p: Panel, in r: CGRect) {
        let s = p.s
        let fw = p.frameWidth
        func fillIn(_ inset: CGFloat, _ color: UIColor) {
            color.setFill()
            UIBezierPath(rect: r.insetBy(dx: inset, dy: inset)).fill()
        }
        func strokeIn(_ inset: CGFloat, _ color: UIColor, _ width: CGFloat) {
            color.setStroke()
            let path = UIBezierPath(rect: r.insetBy(dx: inset, dy: inset))
            path.lineWidth = width
            path.stroke()
        }

        // The wire and the nail, behind the frame.
        let nail = CGPoint(x: r.midX, y: r.minY - 44 * s)
        let wire = UIBezierPath()
        wire.move(to: CGPoint(x: r.minX + 0.2 * r.width, y: r.minY + fw * 0.5))
        wire.addLine(to: nail)
        wire.addLine(to: CGPoint(x: r.minX + 0.8 * r.width, y: r.minY + fw * 0.5))
        wire.lineWidth = 3 * s
        wire.lineJoinStyle = .round
        p.frameInner.setStroke()
        wire.stroke()
        p.frameInner.setFill()
        UIBezierPath(arcCenter: nail, radius: 7 * s, startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
        p.frameAccent.setFill()
        UIBezierPath(arcCenter: CGPoint(x: nail.x - 2 * s, y: nail.y - 2 * s), radius: 3 * s,
                     startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()

        // The moulding.
        fillIn(0, p.frameInner)
        fillIn(3 * s, p.frameColor)
        fillIn(fw * 0.5, UIColor(white: 0, alpha: 0x26 / 255))
        strokeIn(fw * 0.28, p.frameAccent, 2.5 * s)
        strokeIn(fw - 1.5 * s, p.frameInner, 3 * s)
        let joints = UIBezierPath()
        joints.move(to: CGPoint(x: r.minX, y: r.minY))
        joints.addLine(to: CGPoint(x: r.minX + fw, y: r.minY + fw))
        joints.move(to: CGPoint(x: r.maxX, y: r.minY))
        joints.addLine(to: CGPoint(x: r.maxX - fw, y: r.minY + fw))
        joints.move(to: CGPoint(x: r.minX, y: r.maxY))
        joints.addLine(to: CGPoint(x: r.minX + fw, y: r.maxY - fw))
        joints.move(to: CGPoint(x: r.maxX, y: r.maxY))
        joints.addLine(to: CGPoint(x: r.maxX - fw, y: r.maxY - fw))
        joints.lineWidth = 1.5 * s
        p.frameInner.setStroke()
        joints.stroke()

        // Mat and canvas.
        fillIn(fw, p.frameMat)
        fillIn(fw + 12 * s, p.color)
        strokeIn(fw + 12 * s, UIColor(white: 0, alpha: 0x30 / 255), 1.5 * s)

        // Ornaments.
        var spots: [CGPoint] = [
            CGPoint(x: r.minX + fw / 2, y: r.minY + fw / 2),
            CGPoint(x: r.maxX - fw / 2, y: r.minY + fw / 2),
            CGPoint(x: r.minX + fw / 2, y: r.maxY - fw / 2),
            CGPoint(x: r.maxX - fw / 2, y: r.maxY - fw / 2),
        ]
        if r.width > 6 * fw {
            spots.append(CGPoint(x: r.midX, y: r.minY + fw / 2))
            spots.append(CGPoint(x: r.midX, y: r.maxY - fw / 2))
        }
        let d = fw * 0.34
        for c in spots {
            let diamond = UIBezierPath()
            diamond.move(to: CGPoint(x: c.x, y: c.y - d))
            diamond.addLine(to: CGPoint(x: c.x + d, y: c.y))
            diamond.addLine(to: CGPoint(x: c.x, y: c.y + d))
            diamond.addLine(to: CGPoint(x: c.x - d, y: c.y))
            diamond.close()
            p.frameAccent.setFill()
            diamond.fill()
            p.frameInner.setFill()
            UIBezierPath(arcCenter: c, radius: fw * 0.1, startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
        }
    }

    /// `paintPanel` in canvasRenderer.ts.
    private static func drawPanel(_ p: Panel, in r: CGRect) {
        if p.frame == "none" { return }
        let s = p.s
        if (p.shadowDx != 0 || p.shadowDy != 0) && alphaOf(p.shadow) > 0 {
            p.shadow.setFill()
            panelPath(p, r.offsetBy(dx: p.shadowDx, dy: p.shadowDy)).fill()
        }
        if p.frame == "painting" {
            drawPainting(p, in: r)
            return
        }
        p.color.setFill()
        panelPath(p, r).fill()
        if p.frame == "postit" {
            UIColor(white: 0, alpha: 0x12 / 255).setFill()
            UIBezierPath(rect: CGRect(x: r.minX, y: r.maxY - 10 * s, width: r.width, height: 10 * s)).fill()
            let tw = min(0.42 * r.width, 150 * s)
            let th = 34 * s
            let tape = UIBezierPath(rect: CGRect(x: -tw / 2, y: -th / 2, width: tw, height: th))
            tape.apply(CGAffineTransform(rotationAngle: -5 * .pi / 180))
            tape.apply(CGAffineTransform(translationX: r.midX, y: r.minY + 2 * s))
            p.tape.setFill()
            tape.fill()
        }
    }

    /// `paintText` in canvasRenderer.ts.
    private static func drawText(_ text: String, font: UIFont, color: UIColor, ascent: CGFloat,
                                 effect: TextEffect, in r: CGRect) {
        let origin = CGPoint(x: r.minX, y: r.minY + ascent - font.ascender)
        if effect.kind == "marker" {
            // A highlighter stroke across the lower half of the words, leaning right.
            let x0 = r.minX - effect.width
            let w0 = r.width + 2 * effect.width
            let y0 = r.minY + 0.5 * r.height
            let h0 = 0.42 * r.height
            let k = 0.3 * h0
            let bar = UIBezierPath()
            bar.move(to: CGPoint(x: x0 + k, y: y0))
            bar.addLine(to: CGPoint(x: x0 + w0, y: y0))
            bar.addLine(to: CGPoint(x: x0 + w0 - k, y: y0 + h0))
            bar.addLine(to: CGPoint(x: x0, y: y0 + h0))
            bar.close()
            effect.color.setFill()
            bar.fill()
        }
        if effect.kind == "outline" {
            let outline: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: UIColor.clear,
                .strokeColor: effect.color,
                // A percentage of the point size; positive = stroke only.
                .strokeWidth: effect.width / font.pointSize * 100,
            ]
            (text as NSString).draw(at: origin, withAttributes: outline)
        }
        if effect.kind == "shadow" || effect.kind == "glow" || effect.kind == "marker" {
            let shadow = NSShadow()
            shadow.shadowColor = effect.kind == "marker" ? UIColor(white: 0, alpha: 0.55) : effect.color
            shadow.shadowBlurRadius = effect.blur
            shadow.shadowOffset = CGSize(width: 0, height: effect.dy)
            let shadowed: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .shadow: shadow]
            (text as NSString).draw(at: origin, withAttributes: shadowed)
            if effect.kind == "glow" { (text as NSString).draw(at: origin, withAttributes: shadowed) }
        }
        (text as NSString).draw(at: origin, withAttributes: [.font: font, .foregroundColor: color])
    }

    private static func draw(_ paint: Paint, in r: CGRect) {
        switch paint {
        case .none:
            return
        case let .box(color, radius, dx, dy, shadow):
            if (dx != 0 || dy != 0) && alphaOf(shadow) > 0 {
                shadow.setFill()
                roundRect(r.offsetBy(dx: dx, dy: dy), radius).fill()
            }
            color.setFill()
            roundRect(r, radius).fill()
        case let .panel(panel):
            drawPanel(panel, in: r)
        case let .text(text, font, color, ascent, effect):
            drawText(text, font: font, color: color, ascent: ascent, effect: effect, in: r)
        case let .dot(color):
            let c = CGPoint(x: r.midX, y: r.midY)
            let radius = r.width / 2
            UIColor.white.setFill()
            UIBezierPath(arcCenter: c, radius: radius, startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
            color.setFill()
            UIBezierPath(arcCenter: c, radius: radius * 0.72, startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
            UIColor.white.setFill()
            UIBezierPath(arcCenter: c, radius: radius * 0.3, startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
        case let .pin(color):
            let k = r.width / 24
            color.setFill()
            UIBezierPath(arcCenter: CGPoint(x: r.minX + 12 * k, y: r.minY + 9 * k), radius: 7 * k,
                         startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
            let tip = UIBezierPath()
            tip.move(to: CGPoint(x: r.minX + 5.6 * k, y: r.minY + 11.8 * k))
            tip.addLine(to: CGPoint(x: r.minX + 18.4 * k, y: r.minY + 11.8 * k))
            tip.addLine(to: CGPoint(x: r.minX + 12 * k, y: r.minY + 22 * k))
            tip.close()
            tip.fill()
            UIColor.white.setFill()
            UIBezierPath(arcCenter: CGPoint(x: r.minX + 12 * k, y: r.minY + 9 * k), radius: 2.8 * k,
                         startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
        case let .badge(shape, bg, ring, text, font, color, ascent, descent):
            let c = CGPoint(x: r.midX, y: r.midY)
            let ringVisible = alphaOf(ring) > 0
            if shape == "circle" {
                let radius = min(r.width, r.height) / 2
                bg.setFill()
                UIBezierPath(arcCenter: c, radius: radius, startAngle: 0, endAngle: 2 * .pi, clockwise: true).fill()
                if ringVisible {
                    let path = UIBezierPath(arcCenter: c, radius: radius * 0.84, startAngle: 0,
                                            endAngle: 2 * .pi, clockwise: true)
                    path.lineWidth = radius * 0.05
                    path.setLineDash([radius * 0.12, radius * 0.08], count: 2, phase: 0)
                    ring.setStroke()
                    path.stroke()
                }
            } else if shape == "burst" {
                let radius = min(r.width, r.height) / 2
                let spikes = 14
                let path = UIBezierPath()
                for i in 0..<(spikes * 2) {
                    let rr = i % 2 == 0 ? radius : radius * 0.8
                    let angle = -CGFloat.pi / 2 + CGFloat(i) * .pi / CGFloat(spikes)
                    let point = CGPoint(x: c.x + rr * cos(angle), y: c.y + rr * sin(angle))
                    if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
                }
                path.close()
                bg.setFill()
                path.fill()
            } else {
                bg.setFill()
                roundRect(r, r.height * 0.3).fill()
                if ringVisible {
                    let inset = r.height * 0.12
                    let path = roundRect(r.insetBy(dx: inset, dy: inset), r.height * 0.2)
                    path.lineWidth = r.height * 0.05
                    path.setLineDash([r.height * 0.1, r.height * 0.07], count: 2, phase: 0)
                    ring.setStroke()
                    path.stroke()
                }
            }
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
            let width = (text as NSString).size(withAttributes: attributes).width
            let top = c.y - (ascent + descent) / 2
            (text as NSString).draw(at: CGPoint(x: c.x - width / 2, y: top + ascent - font.ascender),
                                    withAttributes: attributes)
        }
    }
}
