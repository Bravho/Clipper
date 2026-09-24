import AVFoundation
import UIKit

/// Turns one still into a short silent MP4 with its Ken Burns motion.
///
/// WHY A SEGMENT FILE AND NOT A LAYER. AVFoundation composition tracks hold
/// media, and a UIImage is not media — there is no way to insert a photo into an
/// `AVMutableComposition`. The alternatives were to animate the still in a
/// Core Animation layer over a black video track (which then cannot be
/// cross-dissolved against a real clip on the same track) or to render the still
/// to frames. Rendering to frames costs a file per still and buys the thing that
/// matters: an image shot and a clip shot become the same kind of thing, so the
/// montage's dissolves, trims and ordering are one mechanism rather than two.
///
/// Each frame is drawn with the same maths Android's `MatrixTransformation`
/// uses — cover-fit the photo to the canvas, then scale about the subject-focus
/// origin and translate by a fraction of the element box.
enum StillSegmentWriter {

    /// Render `image` for `durationSeconds` at `fps` into `output`.
    ///
    /// - Parameters:
    ///   - entranceTransition: the incoming flourish (slide/zoom), applied over
    ///     the first `dissolveSeconds`. `fade` and `cut` add nothing.
    static func write(
        image: UIImage,
        motion: RenderManifest.Motion,
        focusX: CGFloat,
        focusY: CGFloat,
        frameZoom: CGFloat = 1,
        canvas: CGSize,
        fps: Int,
        durationSeconds: Double,
        entranceTransition: RenderManifest.Transition,
        dissolveSeconds: Double,
        output: URL,
        isCancelled: () -> Bool
    ) throws {
        try? FileManager.default.removeItem(at: output)

        guard let cgImage = image.cgImage else {
            throw RenderError.export("A source photo could not be decoded")
        }

        let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(canvas.width),
            AVVideoHeightKey: Int(canvas.height),
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: Int(canvas.width),
                kCVPixelBufferHeightKey as String: Int(canvas.height),
            ]
        )

        guard writer.canAdd(input) else {
            throw RenderError.export("This device cannot encode a still segment")
        }
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        let frameCount = max(1, Int((durationSeconds * Double(fps)).rounded()))
        let timescale = CMTimeScale(fps)
        let sourceSize = CGSize(width: cgImage.width, height: cgImage.height)
        let fit = MotionMath.frameFit(
            source: sourceSize, canvas: canvas,
            frameZoom: frameZoom, focusX: focusX, focusY: focusY)
        // `frameFit` measures y downward; this context's y grows upward.
        let drawnHeight = sourceSize.height * fit.scale
        let drawY = canvas.height - fit.offset.y - drawnHeight

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        var frameIndex = 0

        let queue = DispatchQueue(label: "com.rclipper.stillsegment")
        let finished = DispatchSemaphore(value: 0)
        var failure: Error?

        input.requestMediaDataWhenReady(on: queue) {
            while input.isReadyForMoreMediaData {
                if isCancelled() {
                    failure = RenderError.cancelled
                    input.markAsFinished()
                    finished.signal()
                    return
                }
                if frameIndex >= frameCount {
                    input.markAsFinished()
                    finished.signal()
                    return
                }
                guard let pool = adaptor.pixelBufferPool else {
                    failure = RenderError.export("The still encoder has no pixel buffer pool")
                    input.markAsFinished()
                    finished.signal()
                    return
                }

                var pixelBuffer: CVPixelBuffer?
                guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer) == kCVReturnSuccess,
                      let buffer = pixelBuffer else {
                    failure = RenderError.export("Could not allocate a frame for a still")
                    input.markAsFinished()
                    finished.signal()
                    return
                }

                CVPixelBufferLockBaseAddress(buffer, [])
                if let context = CGContext(
                    data: CVPixelBufferGetBaseAddress(buffer),
                    width: Int(canvas.width),
                    height: Int(canvas.height),
                    bitsPerComponent: 8,
                    bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                    space: colorSpace,
                    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                        | CGBitmapInfo.byteOrder32Little.rawValue
                ) {
                    context.setFillColor(UIColor.black.cgColor)
                    context.fill(CGRect(origin: .zero, size: canvas))

                    let t = Double(frameIndex) / Double(fps)
                    let progress = durationSeconds > 0 ? CGFloat(t / durationSeconds) : 1
                    let kb = MotionMath.kenBurns(motion: motion, progress: progress)

                    var transform = MotionMath.transform(
                        scale: kb.scale,
                        translateXFraction: kb.translateXFraction,
                        translateYFraction: kb.translateYFraction,
                        focusX: focusX,
                        focusY: focusY,
                        canvas: canvas
                    )

                    if dissolveSeconds > 0, t < dissolveSeconds {
                        let fade = CGFloat(t / dissolveSeconds)
                        transform = transform.concatenating(
                            MotionMath.entrance(entranceTransition, fade: fade, canvas: canvas))
                    }

                    context.saveGState()
                    context.concatenate(transform)
                    // Cover-fit first, so the motion operates on the framing the
                    // requester approved rather than on the raw photo.
                    context.draw(cgImage, in: CGRect(
                        x: fit.offset.x,
                        y: drawY,
                        width: sourceSize.width * fit.scale,
                        height: sourceSize.height * fit.scale
                    ))
                    context.restoreGState()
                }
                CVPixelBufferUnlockBaseAddress(buffer, [])

                let time = CMTime(value: CMTimeValue(frameIndex), timescale: timescale)
                if !adaptor.append(buffer, withPresentationTime: time) {
                    failure = RenderError.export("The still encoder rejected a frame")
                    input.markAsFinished()
                    finished.signal()
                    return
                }
                frameIndex += 1
            }
        }

        finished.wait()
        if let failure {
            writer.cancelWriting()
            throw failure
        }

        let completed = DispatchSemaphore(value: 0)
        writer.finishWriting { completed.signal() }
        completed.wait()

        guard writer.status == .completed else {
            throw RenderError.export(
                "A still segment failed to write: \(writer.error?.localizedDescription ?? "unknown")")
        }
    }
}
