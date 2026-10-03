import Foundation
import CoreGraphics

/// The Ken Burns and transition geometry for AVFoundation.
///
/// The Swift half of `src/lib/mobile/deviceRenderCaptions.ts` and the exact
/// counterpart of Android's `MotionMath.java`. The keyframe table is copied
/// verbatim from `remotion/montageMotion.ts` rather than paraphrased, because
/// three implementations of the same motion that were each "written from the
/// spec" would drift within a release.
///
/// COORDINATES. Remotion animates with a CSS transform:
///
///     transform: scale(s) translate(tx%, ty%);
///     transform-origin: focusX% focusY%;
///
/// CSS applies the list right-to-left, so a point p becomes
/// `o + s * (p + t - o)`, where t is in the element's own box. AVFoundation's
/// layer instructions take a `CGAffineTransform` in the composition's PIXEL
/// space with the origin at the bottom-left and y pointing UP, so the
/// conversion is: translate by the fraction times the canvas size (negating y),
/// scale, then correct for the origin.
enum MotionMath {

    struct Keyframes {
        let scaleFrom: CGFloat
        let scaleTo: CGFloat
        let translateXFrom: CGFloat
        let translateXTo: CGFloat
        let translateYFrom: CGFloat
        let translateYTo: CGFloat
    }

    /// Mirrors `KEN_BURNS_KEYFRAMES`. Translates are percentages.
    static func keyframes(_ motion: RenderManifest.Motion) -> Keyframes {
        switch motion {
        case .kenBurnsIn:
            return Keyframes(scaleFrom: 1.00, scaleTo: 1.25,
                             translateXFrom: 0, translateXTo: 0,
                             translateYFrom: 0, translateYTo: 0)
        case .kenBurnsOut:
            return Keyframes(scaleFrom: 1.25, scaleTo: 1.00,
                             translateXFrom: 0, translateXTo: 0,
                             translateYFrom: 0, translateYTo: 0)
        // The camera direction is opposite the image's translation: moving the
        // oversized image right reveals its left side, so the camera pans left.
        case .panLeft:
            return Keyframes(scaleFrom: 1.18, scaleTo: 1.18,
                             translateXFrom: -7, translateXTo: 7,
                             translateYFrom: 0, translateYTo: 0)
        case .panRight:
            return Keyframes(scaleFrom: 1.18, scaleTo: 1.18,
                             translateXFrom: 7, translateXTo: -7,
                             translateYFrom: 0, translateYTo: 0)
        case .staticFrame:
            return Keyframes(scaleFrom: 1.00, scaleTo: 1.00,
                             translateXFrom: 0, translateXTo: 0,
                             translateYFrom: 0, translateYTo: 0)
        }
    }

    static func clamp(_ value: CGFloat, _ minimum: CGFloat, _ maximum: CGFloat) -> CGFloat {
        Swift.min(maximum, Swift.max(minimum, value))
    }

    private static func lerp(_ from: CGFloat, _ to: CGFloat, _ progress: CGFloat) -> CGFloat {
        from + (to - from) * progress
    }

    /// Ken Burns state at `progress` (0...1 across the shot's slot).
    static func kenBurns(
        motion: RenderManifest.Motion, progress: CGFloat
    ) -> (scale: CGFloat, translateXFraction: CGFloat, translateYFraction: CGFloat) {
        let p = clamp(progress, 0, 1)
        let k = keyframes(motion)
        return (
            lerp(k.scaleFrom, k.scaleTo, p),
            lerp(k.translateXFrom, k.translateXTo, p) / 100,
            lerp(k.translateYFrom, k.translateYTo, p) / 100
        )
    }

    /// The scale-about-focus plus box-fraction translate, in canvas pixels.
    static func transform(
        scale: CGFloat,
        translateXFraction: CGFloat,
        translateYFraction: CGFloat,
        focusX: CGFloat,
        focusY: CGFloat,
        canvas: CGSize
    ) -> CGAffineTransform {
        // The focus point comes in as 0...1 from the top-left (CSS); AVFoundation
        // measures from the bottom-left.
        let originX = clamp(focusX, 0, 1) * canvas.width
        let originY = (1 - clamp(focusY, 0, 1)) * canvas.height

        // p + t, with y negated because CSS y grows downward.
        var matrix = CGAffineTransform(
            translationX: translateXFraction * canvas.width,
            y: -translateYFraction * canvas.height
        )
        // s * (p + t)
        matrix = matrix.concatenating(CGAffineTransform(scaleX: scale, y: scale))
        // + o * (1 - s)  ->  o + s * (p + t - o)
        matrix = matrix.concatenating(CGAffineTransform(
            translationX: originX * (1 - scale),
            y: originY * (1 - scale)
        ))
        return matrix
    }

    /// The extra flourish a named transition layers on the incoming shot while
    /// it dissolves in. `fade` is 0 at the start of the overlap and 1 when the
    /// shot is fully on screen.
    static func entrance(
        _ transition: RenderManifest.Transition, fade: CGFloat, canvas: CGSize
    ) -> CGAffineTransform {
        let f = clamp(fade, 0, 1)
        switch transition {
        case .slide:
            return transform(scale: 1, translateXFraction: (1 - f) * 0.12,
                             translateYFraction: 0, focusX: 0.5, focusY: 0.5, canvas: canvas)
        case .zoom:
            return transform(scale: 1.04 - 0.04 * f, translateXFraction: 0,
                             translateYFraction: 0, focusX: 0.5, focusY: 0.5, canvas: canvas)
        case .fade, .cut:
            return .identity
        }
    }

    /// `object-fit: cover` on the canvas: the scale that fills without
    /// letterboxing, and the offset that centres the overflow.
    static func coverFit(source: CGSize, canvas: CGSize) -> (scale: CGFloat, offset: CGPoint) {
        guard source.width > 0, source.height > 0 else { return (1, .zero) }
        let scale = Swift.max(canvas.width / source.width, canvas.height / source.height)
        return (
            scale,
            CGPoint(
                x: (canvas.width - source.width * scale) / 2,
                y: (canvas.height - source.height * scale) / 2
            )
        )
    }

    /// Where a picture goes on the canvas for a zoom and a focus point — the
    /// Swift copy of `framePlacement` in `src/lib/mobile/shotFraming.ts`.
    /// `frameZoom` 0 shows the whole picture (black fills the rest), 1 fills
    /// the canvas and crops around the focus point. The returned origin is
    /// top-left with y DOWN (a video composition's space); convert before
    /// drawing into a Core Graphics context.
    static func frameFit(
        source: CGSize,
        canvas: CGSize,
        frameZoom: CGFloat,
        focusX: CGFloat,
        focusY: CGFloat
    ) -> (scale: CGFloat, offset: CGPoint) {
        guard source.width > 0, source.height > 0 else { return (1, .zero) }
        let fit = Swift.min(canvas.width / source.width, canvas.height / source.height)
        let cover = Swift.max(canvas.width / source.width, canvas.height / source.height)
        let zoom = MotionMath.clamp(frameZoom, 0, 1)
        let scale = fit * pow(cover / fit, zoom)
        let width = source.width * scale
        let height = source.height * scale
        func place(_ drawn: CGFloat, _ room: CGFloat, _ focus: CGFloat) -> CGFloat {
            if drawn <= room { return (room - drawn) / 2 }
            return MotionMath.clamp(room / 2 - MotionMath.clamp(focus, 0, 1) * drawn, room - drawn, 0)
        }
        return (scale, CGPoint(x: place(width, canvas.width, focusX),
                               y: place(height, canvas.height, focusY)))
    }

    /// Playback rate for a clip whose slot outruns its footage — slow it down
    /// rather than freezing the last frame. Mirrors `computeClipPlaybackRate`.
    static func playbackRate(footageSeconds: Double, slotSeconds: Double) -> Double {
        guard footageSeconds > 0, slotSeconds > 0 else { return 1 }
        guard slotSeconds > footageSeconds else { return 1 }
        return Swift.min(1, Swift.max(0.8, footageSeconds / slotSeconds))
    }
}
