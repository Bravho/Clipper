import AVFoundation
import UIKit

/// Turns a validated render manifest into an AVFoundation composition.
///
/// The counterpart of Android's `ManifestRenderer`, with the same three stages —
/// montage, master, final — and the same rule about what each may contain.
///
/// WHERE iOS HAS THE EASIER TIME. `AVMutableVideoCompositionLayerInstruction`
/// has `setOpacityRamp`, so the cross-dissolve is a first-class operation here
/// rather than the two-sequence compositor Android needs. Shots are laid on two
/// alternating composition tracks and the incoming one ramps 0 -> 1 over the
/// overlap, which is the same "mount early, fade in over the previous shot's
/// tail" the Remotion montage does.
///
/// WHERE iOS HAS THE HARDER TIME. A still cannot go into a composition track at
/// all, so each one is pre-rendered to a short segment by
/// `StillSegmentWriter` before it gets here.
///
/// FROM SOURCES (plugin version 6+). When the manifest says `buildFromSources`,
/// a master is the montage's composition plus the mixed audio track, and a
/// final is that plus the template and captions — ONE export from the
/// originals, instead of an export built on the previous stage's download.
struct ManifestRenderer {

    let manifest: RenderManifest
    let workDirectory: URL

    /// A built composition and what the caller needs to export and report it.
    struct Built {
        let asset: AVAsset
        let videoComposition: AVMutableVideoComposition?
        let audioMix: AVAudioMix?
        /// Layers for `AVVideoCompositionCoreAnimationTool`, for the final stage.
        let animationTool: AVVideoCompositionCoreAnimationTool?
        let durationSeconds: Double
        /// Temporary segment files to delete once the export finishes.
        let temporaryFiles: [URL]
        /// What AVFoundation's own validation said about the composition, for
        /// the error log.
        var validationNotes: [String] = []
    }

    /// Where a shot's bytes are, keyed by the manifest's assetId.
    typealias SourceResolver = (String) throws -> URL

    // ── montage ─────────────────────────────────────────────────────────────

    /// The silent intermediate: every approved shot in order, cover-cropped to
    /// the canvas, stills animated, clips trimmed and muted, dissolves applied.
    ///
    /// ONE INTEGER TIMELINE. Every boundary is computed once, in 1/600 s ticks,
    /// from the running total of the shot lengths, and every insert, scale and
    /// instruction is cut from those same numbers. AVFoundation refuses a video
    /// composition whose instructions overlap or leave a gap by even one tick
    /// ("Operation Stopped" at export) — which is what the first iOS build did:
    /// the shot before a dissolve kept its instruction up to the next shot's
    /// start while the dissolve instruction already covered its last
    /// `dissolve` seconds, and separately-rounded CMTimes could also miss by a
    /// tick. Now, around a dissolve into shot i:
    ///
    ///   solo(i-1): [B(i-1), B(i) - D(i))
    ///   dissolve:  [B(i) - D(i), B(i))     both layers, shot i ramping in
    ///   solo(i):   [B(i), B(i+1) - D(i+1))
    ///
    /// and the last instruction ends exactly at the composition's end.
    ///
    /// `hardCuts` drops every dissolve (and entrance flourish): the fallback
    /// when a device will not export the dissolving composition.
    func buildMontage(
        resolve: SourceResolver,
        isCancelled: @escaping () -> Bool,
        hardCuts: Bool = false,
        onSegmentProgress: (Double) -> Void
    ) throws -> Built {
        let shots = manifest.flattenedShots
        guard !shots.isEmpty else { throw RenderError.manifest("The montage manifest has no shots") }

        let canvas = manifest.canvasSize
        let scale: CMTimeScale = 600
        func ticks(_ seconds: Double) -> CMTimeValue {
            CMTimeValue((seconds * Double(scale)).rounded())
        }
        func time(_ value: CMTimeValue) -> CMTime { CMTime(value: value, timescale: scale) }

        // Slot boundaries: B(0) = 0, B(i+1) = B(i) + shot i. A dissolve borrows
        // from the previous shot's tail rather than extending the timeline, so
        // the total is unchanged — exactly as `MontageScene` keeps it.
        var boundaries: [CMTimeValue] = [0]
        var runningSeconds: Double = 0
        for shot in shots {
            runningSeconds += shot.durationSeconds
            boundaries.append(ticks(runningSeconds))
        }
        for index in shots.indices where boundaries[index + 1] <= boundaries[index] {
            throw RenderError.manifest("Shot \(index + 1) has no length")
        }
        // The dissolve INTO each shot, never longer than half of either
        // neighbouring shot, so every solo stretch keeps a positive length.
        var fades: [CMTimeValue] = []
        for index in shots.indices {
            guard index > 0, !hardCuts else {
                fades.append(0)
                continue
            }
            let slot = boundaries[index + 1] - boundaries[index]
            let previous = boundaries[index] - boundaries[index - 1]
            let wanted = ticks(max(0, manifest.dissolve(beforeFlatIndex: index)))
            fades.append(max(0, min(wanted, slot / 2, previous / 2)))
        }
        let total = boundaries[shots.count]

        let composition = AVMutableComposition()
        // Two tracks so consecutive shots can overlap; a single track cannot
        // hold two pieces of media at the same time, which is what a dissolve is.
        guard let trackA = composition.addMutableTrack(
                withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let trackB = composition.addMutableTrack(
                withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else {
            throw RenderError.export("Could not create the montage tracks")
        }
        let tracks = [trackA, trackB]

        var temporaryFiles: [URL] = []
        var placements: [(track: AVMutableCompositionTrack, transform: CGAffineTransform)] = []

        for (index, shot) in shots.enumerated() {
            if isCancelled() { throw RenderError.cancelled }

            let source = try manifest.source(for: shot)
            let url = try resolve(source.assetId)
            let scene = manifest.scene(forFlatIndex: index)
            let transition: RenderManifest.Transition = hardCuts ? .cut : (scene?.transitionIn ?? .fade)
            let fade = fades[index]

            // The incoming shot mounts `fade` early so it overlaps the outgoing
            // shot's tail, and keeps its own end, so the timeline is unchanged.
            let itemStart = boundaries[index] - fade
            let insertAt = time(itemStart)
            let slot = time(boundaries[index + 1] - itemStart)
            let track = tracks[index % 2]

            if source.isImage {
                guard let data = try? Data(contentsOf: url), let image = UIImage(data: data) else {
                    throw RenderError.export("Could not read the photo for shot \(index + 1)")
                }
                let segment = workDirectory.appendingPathComponent("\(UUID().uuidString)-still.mp4")
                try StillSegmentWriter.write(
                    image: image,
                    motion: shot.motion,
                    focusX: CGFloat(shot.focusX),
                    focusY: CGFloat(shot.focusY),
                    frameZoom: CGFloat(shot.zoom),
                    canvas: canvas,
                    fps: manifest.fps,
                    durationSeconds: CMTimeGetSeconds(slot),
                    entranceTransition: transition,
                    dissolveSeconds: CMTimeGetSeconds(time(fade)),
                    output: segment,
                    isCancelled: isCancelled
                )
                temporaryFiles.append(segment)

                let asset = AVURLAsset(url: segment)
                guard let videoTrack = asset.tracks(withMediaType: .video).first,
                      CMTimeCompare(asset.duration, .zero) > 0 else {
                    throw RenderError.export("A rendered still has no video track")
                }
                // The segment is whole frames long, so it can miss the slot by
                // a fraction of a frame; stretch it to the exact slot so the
                // track has no gap for the instructions to fall into.
                let take = CMTimeMinimum(slot, asset.duration)
                try track.insertTimeRange(
                    CMTimeRange(start: .zero, duration: take), of: videoTrack, at: insertAt)
                if CMTimeCompare(take, slot) != 0 {
                    track.scaleTimeRange(CMTimeRange(start: insertAt, duration: take), toDuration: slot)
                }
                // Already at canvas size and already animated: no transform.
                placements.append((track, .identity))
            } else {
                let asset = AVURLAsset(url: url)
                guard let videoTrack = asset.tracks(withMediaType: .video).first else {
                    throw RenderError.export("A source clip has no video track")
                }

                let trimStart = CMTime(seconds: shot.trimStartSeconds ?? 0, preferredTimescale: scale)
                let available = CMTimeSubtract(videoTrack.timeRange.end, trimStart)
                let windowEnd = shot.trimEndSeconds.map {
                    CMTime(seconds: $0, preferredTimescale: scale)
                }
                var footage = windowEnd.map { CMTimeSubtract($0, trimStart) } ?? available
                footage = CMTimeMinimum(footage, available)

                guard CMTimeCompare(footage, CMTime(value: 1, timescale: CMTimeScale(manifest.fps))) >= 0
                else {
                    throw RenderError.export("A clip trim starts past the end of its video")
                }

                let take = CMTimeMinimum(footage, slot)
                try track.insertTimeRange(
                    CMTimeRange(start: trimStart, duration: take), of: videoTrack, at: insertAt)
                // Slow the clip to fill a slot longer than its footage, rather
                // than freezing the last frame — and fill it EXACTLY.
                if CMTimeCompare(take, slot) != 0 {
                    track.scaleTimeRange(CMTimeRange(start: insertAt, duration: take), toDuration: slot)
                }

                // `preferredTransform` carries the camera's portrait rotation;
                // then the storyboard's framing places it on the canvas.
                let oriented = CGRect(origin: .zero, size: videoTrack.naturalSize)
                    .applying(videoTrack.preferredTransform).standardized
                guard oriented.width > 0, oriented.height > 0 else {
                    throw RenderError.export("A source clip has an empty video frame")
                }
                let fit = MotionMath.frameFit(
                    source: oriented.size, canvas: canvas,
                    frameZoom: CGFloat(shot.zoom),
                    focusX: CGFloat(shot.focusX), focusY: CGFloat(shot.focusY))
                var transform = videoTrack.preferredTransform
                    .concatenating(CGAffineTransform(
                        translationX: -oriented.minX, y: -oriented.minY))
                    .concatenating(CGAffineTransform(scaleX: fit.scale, y: fit.scale))
                    .concatenating(CGAffineTransform(
                        translationX: fit.offset.x, y: fit.offset.y))

                if fade > 0, transition == .slide || transition == .zoom {
                    // A clip cannot be animated per frame through a layer
                    // instruction, so the flourish is applied at its midpoint —
                    // a static offset rather than a movement. The one place iOS
                    // approximates the Remotion entrance (`slide`, `zoom` only).
                    transform = transform.concatenating(
                        MotionMath.entrance(transition, fade: 0.5, canvas: canvas))
                }
                placements.append((track, transform))
            }
        }

        // Contiguous instructions over the integer timeline (see above).
        func layer(_ placement: (track: AVMutableCompositionTrack, transform: CGAffineTransform))
            -> AVMutableVideoCompositionLayerInstruction {
            let instruction = AVMutableVideoCompositionLayerInstruction(assetTrack: placement.track)
            instruction.setTransform(placement.transform, at: .zero)
            return instruction
        }
        var instructions: [AVMutableVideoCompositionInstruction] = []
        for index in shots.indices {
            let fade = fades[index]
            if fade > 0, index > 0 {
                let fadeRange = CMTimeRange(
                    start: time(boundaries[index] - fade), duration: time(fade))
                let incoming = layer(placements[index])
                incoming.setOpacityRamp(fromStartOpacity: 0, toEndOpacity: 1, timeRange: fadeRange)
                let dissolve = AVMutableVideoCompositionInstruction()
                dissolve.timeRange = fadeRange
                // The incoming layer is listed FIRST: layer instructions are
                // composited front to back, so the one fading in is on top.
                dissolve.layerInstructions = [incoming, layer(placements[index - 1])]
                instructions.append(dissolve)
            }
            let soloStart = boundaries[index]
            let soloEnd = boundaries[index + 1] - (index + 1 < shots.count ? fades[index + 1] : 0)
            if soloEnd > soloStart {
                let solo = AVMutableVideoCompositionInstruction()
                solo.timeRange = CMTimeRange(start: time(soloStart), end: time(soloEnd))
                solo.layerInstructions = [layer(placements[index])]
                instructions.append(solo)
            }
            onSegmentProgress(Double(index + 1) / Double(shots.count))
        }

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = canvas
        videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(manifest.fps))
        videoComposition.instructions = instructions

        // Ask AVFoundation itself before exporting, and keep what it says for
        // the error log: a refusal at export only says "Operation Stopped".
        let check = CompositionCheck()
        _ = videoComposition.isValid(
            for: composition,
            timeRange: CMTimeRange(start: .zero, duration: time(total)),
            validationDelegate: check)

        return Built(
            asset: composition,
            videoComposition: videoComposition,
            audioMix: nil,
            animationTool: nil,
            durationSeconds: CMTimeGetSeconds(time(total)),
            temporaryFiles: temporaryFiles,
            validationNotes: check.problems
                + ["Montage: \(shots.count) shots, \(instructions.count) instructions, "
                   + "\(hardCuts ? "hard cuts" : "dissolves"), "
                   + String(format: "%.3f s", CMTimeGetSeconds(time(total)))]
        )
    }

    // ── master ──────────────────────────────────────────────────────────────

    /// The montage plus the pre-mixed audio track.
    ///
    /// The mix is a single AAC file produced by `AudioMixer` before this is
    /// called, so all that is left is to put the picture and that track on one
    /// timeline. Doing it this way — rather than handing AVFoundation the voice
    /// and music as separate tracks with an `AVAudioMix` volume ramp — is what
    /// makes the lead-in, the loudness normalisation and the ducking match the
    /// server at all.
    func buildMaster(montage: URL, mixedAudio: URL) throws -> Built {
        let composition = AVMutableComposition()
        let montageAsset = AVURLAsset(url: montage)
        let audioAsset = AVURLAsset(url: mixedAudio)

        guard let sourceVideo = montageAsset.tracks(withMediaType: .video).first else {
            throw RenderError.missingInput("a montage with a video track")
        }
        guard let sourceAudio = audioAsset.tracks(withMediaType: .audio).first else {
            throw RenderError.missingInput("the mixed audio track")
        }
        guard let videoTrack = composition.addMutableTrack(
                withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioTrack = composition.addMutableTrack(
                withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else {
            throw RenderError.export("Could not create the master tracks")
        }

        try videoTrack.insertTimeRange(
            CMTimeRange(start: .zero, duration: montageAsset.duration),
            of: sourceVideo, at: .zero)
        videoTrack.preferredTransform = sourceVideo.preferredTransform

        // The mixed track already spans max(picture, voice + lead-in), so it may
        // be LONGER than the montage — that is the case where the narration
        // outruns the picture, and clipping it here would be the bug the server
        // takes care to avoid with its black tail.
        try audioTrack.insertTimeRange(
            CMTimeRange(start: .zero, duration: audioAsset.duration),
            of: sourceAudio, at: .zero)

        return Built(
            asset: composition,
            videoComposition: nil,
            audioMix: nil,
            animationTool: nil,
            durationSeconds: CMTimeGetSeconds(
                CMTimeMaximum(montageAsset.duration, audioAsset.duration)),
            temporaryFiles: []
        )
    }

    // ── final ───────────────────────────────────────────────────────────────

    /// The delivered export: the approved master with the template and timed
    /// captions burned in, its audio carried straight through.
    ///
    /// The master already carries the mixed voice and ducked music, so nothing
    /// here touches the audio — the same decision `overlayOnMaster` makes with
    /// `-c:a copy`.
    func buildFinal(master: URL, includeTemplate: Bool = true) throws -> Built {
        let asset = AVURLAsset(url: master)
        guard let sourceVideo = asset.tracks(withMediaType: .video).first else {
            throw RenderError.missingInput("a master with a video track")
        }

        let canvas = manifest.canvasSize
        let composition = AVMutableComposition()
        guard let videoTrack = composition.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.export("Could not create the export video track")
        }
        try videoTrack.insertTimeRange(
            CMTimeRange(start: .zero, duration: asset.duration), of: sourceVideo, at: .zero)

        if let sourceAudio = asset.tracks(withMediaType: .audio).first,
           let audioTrack = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try audioTrack.insertTimeRange(
                CMTimeRange(start: .zero, duration: asset.duration), of: sourceAudio, at: .zero)
        }

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)

        let oriented = CGRect(origin: .zero, size: sourceVideo.naturalSize)
            .applying(sourceVideo.preferredTransform).standardized
        let fit = MotionMath.coverFit(source: oriented.size, canvas: canvas)
        layer.setTransform(
            sourceVideo.preferredTransform
                .concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
                .concatenating(CGAffineTransform(scaleX: fit.scale, y: fit.scale))
                .concatenating(CGAffineTransform(translationX: fit.offset.x, y: fit.offset.y)),
            at: .zero
        )
        instruction.layerInstructions = [layer]

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = canvas
        videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(manifest.fps))
        videoComposition.instructions = [instruction]

        let animationTool = buildOverlayLayers(canvas: canvas, includeTemplate: includeTemplate)
        return Built(
            asset: composition,
            videoComposition: videoComposition,
            audioMix: nil,
            animationTool: animationTool,
            durationSeconds: CMTimeGetSeconds(asset.duration),
            temporaryFiles: []
        )
    }

    // ── master and final, straight from the originals ────────────────────────

    /// The montage's composition plus the mixed audio: the master in one export.
    ///
    /// The mixed track spans max(picture, voice + lead-in). When it outruns the
    /// picture, the video composition gets a trailing instruction with no layers
    /// — black — up to the audio's end, as the server pads with black rather
    /// than freezing the last frame. (AVFoundation also requires the
    /// instructions to cover the whole composition, so this is not optional.)
    func addingAudio(to picture: Built, mixedAudio: URL) throws -> Built {
        guard let composition = picture.asset as? AVMutableComposition else {
            throw RenderError.export("The montage composition cannot take an audio track")
        }
        let audioAsset = AVURLAsset(url: mixedAudio)
        guard let sourceAudio = audioAsset.tracks(withMediaType: .audio).first else {
            throw RenderError.missingInput("the mixed audio track")
        }
        guard let audioTrack = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.export("Could not create the audio track")
        }
        try audioTrack.insertTimeRange(
            CMTimeRange(start: .zero, duration: audioAsset.duration), of: sourceAudio, at: .zero)

        // The picture ends where its last instruction ends — the exact tick,
        // not a re-rounded double, or the tail would overlap or leave a gap.
        let pictureEnd = picture.videoComposition?.instructions.last?.timeRange.end
            ?? CMTime(seconds: picture.durationSeconds, preferredTimescale: 600)
        let end = CMTimeMaximum(pictureEnd, audioAsset.duration)
        if let videoComposition = picture.videoComposition,
           CMTimeCompare(end, pictureEnd) > 0 {
            let tail = AVMutableVideoCompositionInstruction()
            tail.timeRange = CMTimeRange(start: pictureEnd, end: end)
            tail.layerInstructions = []
            tail.backgroundColor = UIColor.black.cgColor
            videoComposition.instructions.append(tail)
        }

        return Built(
            asset: composition,
            videoComposition: picture.videoComposition,
            audioMix: nil,
            animationTool: nil,
            durationSeconds: CMTimeGetSeconds(end),
            temporaryFiles: picture.temporaryFiles,
            validationNotes: picture.validationNotes
        )
    }

    /// The master built above, decorated: the delivered video in one export.
    func decorated(_ master: Built, includeTemplate: Bool) -> Built {
        Built(
            asset: master.asset,
            videoComposition: master.videoComposition,
            audioMix: master.audioMix,
            animationTool: buildOverlayLayers(
                canvas: manifest.canvasSize, includeTemplate: includeTemplate),
            durationSeconds: master.durationSeconds,
            temporaryFiles: master.temporaryFiles,
            validationNotes: master.validationNotes
        )
    }

    /// The Core Animation layer tree, in the composition's order: the video
    /// (inset into the card for framed_cream), the template's animated layers,
    /// and one caption layer per cue timed with keyframe animations.
    private func buildOverlayLayers(
        canvas: CGSize, includeTemplate: Bool
    ) -> AVVideoCompositionCoreAnimationTool? {
        let templateLayer = includeTemplate
            ? OverlayPainter.templateLayer(manifest.template, canvas: canvas) : nil
        let hasCaptions = !manifest.captions.isEmpty && !manifest.captionLanguages.isEmpty
        guard templateLayer != nil || hasCaptions else { return nil }

        let videoLayer = CALayer()
        // framed_cream: the picture scaled to cover the card's window, centred
        // on it; the template's canvas and card cover whatever spills past.
        videoLayer.frame = templateLayer != nil && OverlayPainter.isInset(manifest.template)
            ? OverlayPainter.insetVideoFrame(canvas)
            : CGRect(origin: .zero, size: canvas)

        let parentLayer = CALayer()
        parentLayer.frame = CGRect(origin: .zero, size: canvas)
        parentLayer.backgroundColor = UIColor.black.cgColor
        parentLayer.addSublayer(videoLayer)

        if let templateLayer {
            // The template goes UNDER the captions, matching the composition —
            // a template scrim that covered the text would be worse than none.
            parentLayer.addSublayer(templateLayer)
        }

        if hasCaptions {
            let s = OverlayPainter.scale(for: canvas)
            for caption in manifest.captions {
                guard let drawn = OverlayPainter.drawCaption(
                    caption, languages: manifest.captionLanguages, canvas: canvas) else { continue }

                let layer = CALayer()
                // Core Animation's origin is bottom-left, and the composition
                // anchors the stack `stackBottom` above the frame's bottom edge.
                // The anchor is the stack's bottom centre, which the pop-in
                // scales about; `position` is that anchor's location.
                layer.bounds = CGRect(origin: .zero, size: drawn.size)
                layer.anchorPoint = CGPoint(x: 0.5, y: 0)
                layer.position = CGPoint(x: canvas.width / 2, y: OverlayPainter.stackBottom * s)
                layer.contents = drawn.image.cgImage
                layer.opacity = 0

                let begin = AVCoreAnimationBeginTimeAtZero + caption.startSeconds
                let visible = max(0.01, caption.endSeconds - caption.startSeconds)

                let opacity = CAKeyframeAnimation(keyPath: "opacity")
                opacity.values = [0, 1, 1, 0]
                opacity.keyTimes = [
                    0,
                    NSNumber(value: min(1, OverlayPainter.appearSeconds / visible)),
                    0.999,
                    1,
                ]
                opacity.beginTime = begin
                opacity.duration = visible
                opacity.isRemovedOnCompletion = false
                opacity.fillMode = .both
                layer.add(opacity, forKey: "captionOpacity")

                let pop = CAKeyframeAnimation(keyPath: "transform.scale")
                pop.values = [OverlayPainter.appearScaleFrom, 1.0]
                pop.keyTimes = [0, NSNumber(value: min(1, OverlayPainter.appearSeconds / visible))]
                pop.beginTime = begin
                pop.duration = visible
                pop.isRemovedOnCompletion = false
                pop.fillMode = .both
                layer.add(pop, forKey: "captionPop")

                parentLayer.addSublayer(layer)
            }
        }

        return AVVideoCompositionCoreAnimationTool(
            postProcessingAsVideoLayer: videoLayer, in: parentLayer)
    }
}

/// Collects what `AVVideoComposition.isValid` objects to, in words.
final class CompositionCheck: NSObject, AVVideoCompositionValidationHandling {
    private(set) var problems: [String] = []

    func videoComposition(
        _ videoComposition: AVVideoComposition,
        shouldContinueValidatingAfterFindingInvalidValueForKey key: String
    ) -> Bool {
        problems.append("Composition check: invalid value for \(key)")
        return true
    }

    func videoComposition(
        _ videoComposition: AVVideoComposition,
        shouldContinueValidatingAfterFindingEmptyTimeRange timeRange: CMTimeRange
    ) -> Bool {
        problems.append(String(
            format: "Composition check: no instruction covers %.3f–%.3f s",
            CMTimeGetSeconds(timeRange.start), CMTimeGetSeconds(timeRange.end)))
        return true
    }

    func videoComposition(
        _ videoComposition: AVVideoComposition,
        shouldContinueValidatingAfterFindingInvalidTimeRangeIn videoCompositionInstruction: AVVideoCompositionInstructionProtocol
    ) -> Bool {
        let range = videoCompositionInstruction.timeRange
        problems.append(String(
            format: "Composition check: instruction %.3f–%.3f s overlaps or is out of order",
            CMTimeGetSeconds(range.start), CMTimeGetSeconds(range.end)))
        return true
    }

    func videoComposition(
        _ videoComposition: AVVideoComposition,
        shouldContinueValidatingAfterFindingInvalidTrackIDIn videoCompositionInstruction: AVVideoCompositionInstructionProtocol,
        layerInstruction: AVVideoCompositionLayerInstruction,
        asset: AVAsset
    ) -> Bool {
        problems.append("Composition check: a layer refers to track \(layerInstruction.trackID), which the asset does not have")
        return true
    }
}
