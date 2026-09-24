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

                // `paint-order: stroke fill`: the outline is drawn under the
                // glyph fill so the stroke never eats into the letterforms. On
                // iOS a NEGATIVE stroke width means "stroke and fill", which is
                // exactly that ordering in one pass.
                context.cgContext.setShadow(
                    offset: shadowOffset,
                    blur: shadowBlur,
                    color: UIColor.black.withAlphaComponent(0.9).cgColor
                )
                let stroked = NSMutableAttributedString(attributedString: line.attributed)
                stroked.addAttributes([
                    .strokeColor: UIColor.black,
                    .strokeWidth: -(strokeWidth * s) / (fontSizeOf(line.attributed) / 100),
                ], range: NSRange(location: 0, length: stroked.length))
                stroked.draw(with: textRect, options: [.usesLineFragmentOrigin], context: nil)

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

    /// The composition's look for a template: chosen by id, as the composition
    /// chooses it, with the catalogue's frame as the fallback for an id this
    /// build does not know.
    static func look(_ template: RenderManifest.Template) -> String {
        switch template.id {
        case "clean_frame", "framed_cream", "editorial", "none":
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
    /// centred on it (the composition's `objectFit: cover`). The overflow sits
    /// under the card and canvas the template layer draws on top.
    static func insetVideoFrame(_ canvas: CGSize) -> CGRect {
        let window = insetWindow(canvas)
        let scale = max(window.width / canvas.width, window.height / canvas.height)
        let size = CGSize(width: canvas.width * scale, height: canvas.height * scale)
        let centerX = window.midX
        let centerYFromBottom = canvas.height - window.midY
        return CGRect(x: centerX - size.width / 2, y: centerYFromBottom - size.height / 2,
                      width: size.width, height: size.height)
    }

    /// The animated template layer for `AVVideoCompositionCoreAnimationTool`,
    /// or nil for "none". Drawn in top-left coordinates inside a
    /// geometry-flipped container, timed from `AVCoreAnimationBeginTimeAtZero`.
    static func templateLayer(_ template: RenderManifest.Template, canvas: CGSize) -> CALayer? {
        let look = look(template)
        guard look != "none" else { return nil }
        let palette = Palette(template.palette)
        let s = scale(for: canvas)

        let container = CALayer()
        container.frame = CGRect(origin: .zero, size: canvas)
        container.isGeometryFlipped = true

        switch look {
        case "clean_frame":
            buildCleanFrame(in: container, canvas: canvas, s: s, palette: palette)
        case "framed_cream":
            buildFramedCream(in: container, canvas: canvas, s: s, palette: palette)
        case "editorial":
            buildEditorial(in: container, canvas: canvas, s: s, palette: palette)
        default:
            break
        }
        return container
    }

    // clean_frame: brackets ease in over 0.7 s, two ripples pulse from the
    // bottom-left every 3.6 s, an accent bar at the top centre.
    private static func buildCleanFrame(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette
    ) {
        let size = 90 * s
        let inset = 44 * s
        let border = max(3, 7 * s)
        let radius = 22 * s
        let slide = 20 * s

        let corners: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (inset, inset, 1, 1),
            (canvas.width - inset, inset, -1, 1),
            (inset, canvas.height - inset, 1, -1),
            (canvas.width - inset, canvas.height - inset, -1, -1),
        ]
        for (x, y, dx, dy) in corners {
            let path = bracketPath(x: x, y: y, size: size, border: border, radius: radius, dx: dx, dy: dy)
            let layer = CAShapeLayer()
            layer.frame = container.bounds
            layer.path = path
            layer.fillColor = nil
            layer.strokeColor = UIColor.white.cgColor
            layer.lineWidth = border
            layer.shadowColor = UIColor.black.cgColor
            layer.shadowOpacity = 0.55
            layer.shadowRadius = 2
            layer.shadowOffset = CGSize(width: 0, height: 1)
            layer.opacity = 0.95
            container.addSublayer(layer)

            // Fade up and slide in from the corner over 0.7 s, then hold.
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0
            fade.toValue = 0.95
            let move = CABasicAnimation(keyPath: "transform.translation")
            move.fromValue = NSValue(cgSize: CGSize(width: -dx * slide, height: -dy * slide))
            move.toValue = NSValue(cgSize: .zero)
            for animation in [fade, move] {
                animation.beginTime = AVCoreAnimationBeginTimeAtZero
                animation.duration = 0.7
                animation.fillMode = .both
                animation.isRemovedOnCompletion = false
                layer.add(animation, forKey: nil)
            }
        }

        // Ripples: diameter 0.15 → 1 of 32 % of the short side, opacity
        // 0 → 0.5 → 0 over each 3.6 s period, the second offset by 1.8 s.
        let maxDiameter = min(canvas.width, canvas.height) * 0.32
        let center = CGPoint(x: canvas.width * 0.13, y: canvas.height * 0.84)
        let ringWidth = max(2, 2.5 * s)
        for delay in [0.0, 1.8] {
            let ring = CAShapeLayer()
            let r = maxDiameter / 2 - ringWidth / 2
            ring.frame = CGRect(x: center.x - maxDiameter / 2, y: center.y - maxDiameter / 2,
                                width: maxDiameter, height: maxDiameter)
            ring.path = UIBezierPath(
                ovalIn: CGRect(x: ringWidth / 2, y: ringWidth / 2, width: r * 2, height: r * 2)).cgPath
            ring.fillColor = nil
            ring.strokeColor = palette.accent.cgColor
            ring.lineWidth = ringWidth
            ring.opacity = 0
            container.addSublayer(ring)

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
            // The time offset starts the second ring half a period in, as the
            // composition's `(t + delay) % period` does.
            group.beginTime = AVCoreAnimationBeginTimeAtZero
            group.timeOffset = delay
            group.fillMode = .both
            group.isRemovedOnCompletion = false
            ring.add(group, forKey: nil)
        }

        let bar = CAShapeLayer()
        bar.frame = container.bounds
        bar.path = UIBezierPath(
            roundedRect: CGRect(x: (canvas.width - 56 * s) / 2, y: 54 * s, width: 56 * s, height: 5 * s),
            cornerRadius: 5 * s).cgPath
        bar.fillColor = palette.accent.cgColor
        bar.opacity = 0.9
        container.addSublayer(bar)
        bar.add(fadeIn(to: 0.9, begin: 0, duration: 0.7), forKey: nil)
    }

    private static func bracketPath(
        x: CGFloat, y: CGFloat, size: CGFloat, border: CGFloat, radius: CGFloat, dx: CGFloat, dy: CGFloat
    ) -> CGPath {
        let half = border / 2
        let cx = x + dx * half
        let cy = y + dy * half
        let r = max(0, radius - half)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: x + dx * size, y: cy))
        path.addLine(to: CGPoint(x: cx + dx * r, y: cy))
        path.addQuadCurve(to: CGPoint(x: cx, y: cy + dy * r), control: CGPoint(x: cx, y: cy))
        path.addLine(to: CGPoint(x: cx, y: y + dy * size))
        return path
    }

    // framed_cream: the video inset in a white card on the warm neutral canvas,
    // with a branch, a wave and three dots drawn on in the bottom margin and an
    // accent sparkle, all drawing on between 0.2 s and 1.6 s.
    private static func buildFramedCream(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette
    ) {
        let card = cardRect(canvas)
        let window = insetWindow(canvas)

        // Canvas + card with the window punched out, as one even-odd shape.
        let surround = CAShapeLayer()
        surround.frame = container.bounds
        let surroundPath = CGMutablePath()
        surroundPath.addRect(CGRect(origin: .zero, size: canvas))
        surroundPath.addPath(UIBezierPath(roundedRect: window, cornerRadius: 22).cgPath)
        surround.path = surroundPath
        surround.fillRule = .evenOdd
        surround.fillColor = palette.neutral.cgColor
        container.addSublayer(surround)

        let cardLayer = CAShapeLayer()
        cardLayer.frame = container.bounds
        let cardPath = CGMutablePath()
        cardPath.addPath(UIBezierPath(roundedRect: card, cornerRadius: 34).cgPath)
        cardPath.addPath(UIBezierPath(roundedRect: window, cornerRadius: 22).cgPath)
        cardLayer.path = cardPath
        cardLayer.fillRule = .evenOdd
        cardLayer.fillColor = UIColor.white.cgColor
        // 0 16px 42px rgba(0,0,0,0.22)
        cardLayer.shadowColor = UIColor.black.cgColor
        cardLayer.shadowOpacity = 0.22
        cardLayer.shadowRadius = 21
        cardLayer.shadowOffset = CGSize(width: 0, height: 16)
        // The shadow is shaped like the card WITH its window, so it never falls
        // across the video. A shadow path fills non-zero, so the window is
        // added in the opposite winding to cut it out.
        let shadowPath = CGMutablePath()
        shadowPath.addPath(UIBezierPath(roundedRect: card, cornerRadius: 34).cgPath)
        shadowPath.addPath(UIBezierPath(roundedRect: window, cornerRadius: 22).reversing().cgPath)
        cardLayer.shadowPath = shadowPath
        container.addSublayer(cardLayer)

        let ink = palette.primary
        let strokeWidth = max(2.5, 3.2 * s)
        let dash = canvas.width * 2

        // The botanical branch in its own units, scaled by s (stroke too).
        let branchPaths: [CGPath] = {
            var paths: [CGPath] = []
            let main = CGMutablePath()
            main.move(to: CGPoint(x: 0, y: 60))
            main.addCurve(to: CGPoint(x: 190, y: 6), control1: CGPoint(x: 60, y: 44),
                          control2: CGPoint(x: 120, y: 40))
            paths.append(main)
            for (x, y, c1, c2, e1, e2) in [
                (46.0, 48.0, 6.0, -22.0, -14.0, -30.0),
                (84.0, 40.0, 8.0, -22.0, -12.0, -32.0),
                (124.0, 30.0, 10.0, -22.0, -10.0, -34.0),
                (162.0, 16.0, 10.0, -20.0, -8.0, -32.0),
            ] {
                let leaf = CGMutablePath()
                leaf.move(to: CGPoint(x: x, y: y))
                leaf.addQuadCurve(to: CGPoint(x: x + e1, y: y + e2), control: CGPoint(x: x + c1, y: y + c2))
                paths.append(leaf)
            }
            return paths
        }()
        // Each branch path is placed with the group's transform baked in:
        // translate(66 %, 90 %) scale(s).
        let place = CGAffineTransform(translationX: canvas.width * 0.66, y: canvas.height * 0.9)
            .scaledBy(x: s, y: s)
        for path in branchPaths {
            var transform = place
            guard let placed = path.copy(using: &transform) else { continue }
            let layer = strokeLayer(placed, color: ink.withAlphaComponent(0.6),
                                    width: strokeWidth * s, frame: container.bounds)
            // Visible length = min(length, draw * dash) in the group's units.
            layer.add(drawOn(pathLength: approximateLength(path), dash: dash,
                             begin: 0.2, duration: 1.4), forKey: nil)
            container.addSublayer(layer)
        }

        // The wave across the bottom margin.
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
        let waveLayer = strokeLayer(wave, color: ink.withAlphaComponent(0.55),
                                    width: strokeWidth, frame: container.bounds)
        waveLayer.add(drawOn(pathLength: approximateLength(wave), dash: dash,
                             begin: 0.2, duration: 1.4), forKey: nil)
        container.addSublayer(waveLayer)

        // Three dots on the left, fading up with the draw.
        let dots = CAShapeLayer()
        dots.frame = container.bounds
        let dotsPath = CGMutablePath()
        for (x, y, r) in [(0.12, 0.9, 4.0), (0.16, 0.93, 3.0), (0.10, 0.955, 3.0)] {
            let radius = CGFloat(r) * s
            dotsPath.addEllipse(in: CGRect(x: canvas.width * CGFloat(x) - radius,
                                           y: canvas.height * CGFloat(y) - radius,
                                           width: radius * 2, height: radius * 2))
        }
        dots.path = dotsPath
        dots.fillColor = ink.cgColor
        dots.opacity = 0.5
        dots.add(fadeIn(to: 0.5, begin: 0.2, duration: 1.4), forKey: nil)
        container.addSublayer(dots)

        let sparkle = CAShapeLayer()
        sparkle.frame = container.bounds
        sparkle.path = star4(center: CGPoint(x: canvas.width * 0.1, y: canvas.height * 0.04), r: 16 * s)
        sparkle.fillColor = palette.accent.cgColor
        sparkle.opacity = 0.8
        sparkle.add(fadeIn(to: 0.8, begin: 0.2, duration: 1.4), forKey: nil)
        container.addSublayer(sparkle)
    }

    // editorial: top and bottom scrims, a hairline rounded frame drawn on, and
    // an accent kicker, all between 0.2 s and 1.5 s.
    private static func buildEditorial(
        in container: CALayer, canvas: CGSize, s: CGFloat, palette: Palette
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
        let perimeter = 2 * (rect.width + rect.height)
        let frame = strokeLayer(UIBezierPath(roundedRect: rect, cornerRadius: 18 * s).cgPath,
                                color: palette.neutral.withAlphaComponent(0.85),
                                width: border, frame: container.bounds)
        frame.lineCap = .butt
        let draw = drawOn(pathLength: perimeter, dash: perimeter, begin: 0.2, duration: 1.3)
        frame.add(draw, forKey: nil)
        frame.add(fadeIn(to: 1, begin: 0.2, duration: 1.3), forKey: "fade")
        container.addSublayer(frame)

        let kicker = CAShapeLayer()
        kicker.frame = container.bounds
        let kickerPath = CGMutablePath()
        kickerPath.addEllipse(in: CGRect(x: inset + 34 * s - 6 * s, y: inset + 42 * s - 6 * s,
                                         width: 12 * s, height: 12 * s))
        kickerPath.addPath(UIBezierPath(
            roundedRect: CGRect(x: inset + 50 * s, y: inset + 39 * s, width: 96 * s, height: 5 * s),
            cornerRadius: 2.5 * s).cgPath)
        kicker.path = kickerPath
        kicker.fillColor = palette.accent.cgColor
        kicker.add(fadeIn(to: 1, begin: 0.2, duration: 1.3), forKey: nil)
        container.addSublayer(kicker)
    }

    // ── template helpers ────────────────────────────────────────────────────

    private static func strokeLayer(_ path: CGPath, color: UIColor, width: CGFloat, frame: CGRect) -> CAShapeLayer {
        let layer = CAShapeLayer()
        layer.frame = frame
        layer.path = path
        layer.fillColor = nil
        layer.strokeColor = color.cgColor
        layer.lineWidth = width
        layer.lineCap = .round
        layer.lineJoin = .round
        layer.strokeEnd = 1
        return layer
    }

    /// `stroke-dasharray: dash; stroke-dashoffset: dash * (1 - draw)`, with
    /// `draw` rising linearly from `begin` over `duration`: the visible length
    /// is `draw * dash`, so the stroke completes when `draw` reaches
    /// `length / dash` — earlier than the end of the ramp for a short path.
    private static func drawOn(pathLength: CGFloat, dash: CGFloat, begin: Double, duration: Double) -> CAAnimation {
        let completeAt = duration * Double(min(1, max(0.0001, pathLength / dash)))
        let animation = CABasicAnimation(keyPath: "strokeEnd")
        animation.fromValue = 0
        animation.toValue = 1
        animation.beginTime = AVCoreAnimationBeginTimeAtZero + begin
        animation.duration = completeAt
        animation.fillMode = .both
        animation.isRemovedOnCompletion = false
        return animation
    }

    private static func fadeIn(to value: Float, begin: Double, duration: Double) -> CAAnimation {
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = 0
        animation.toValue = value
        animation.beginTime = AVCoreAnimationBeginTimeAtZero + begin
        animation.duration = duration
        animation.fillMode = .both
        animation.isRemovedOnCompletion = false
        return animation
    }

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

    private static func transparentFormat() -> UIGraphicsImageRendererFormat {
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        format.scale = 1
        return format
    }
}
