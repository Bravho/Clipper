import AVFoundation
import UIKit

/// One manifest render, start to finish.
///
/// The counterpart of Android's `ManifestJob`: fetch what the stage needs,
/// build the composition, export it, and — for a final export — pull the cover
/// out of the video that was just produced.
///
/// PROGRESS IS WEIGHTED, NOT LINEAR. A phone export is perhaps a tenth
/// downloading and nine tenths encoding, so reporting the export session's raw
/// fraction would sit at 0 through the whole download and then race. The weights
/// below are rough but honest, which is the point of a progress bar.
final class ManifestJob {

    private static let downloadShare = 0.15
    private static let renderShare = 0.80

    struct Result {
        var output: URL
        var cover: URL?
        var fileSizeBytes: Int
        var durationSeconds: Double
        var hasAudioTrack: Bool
        var width: Int
        var height: Int
        var stage: String
        /// iOS dissolves natively through opacity ramps, so this is always true.
        /// Reported anyway, so a tester comparing a phone export to the Mac's
        /// never has to guess which path produced it.
        var crossDissolved: Bool
    }

    private let manifest: RenderManifest
    private let workDirectory: URL
    /// assetId — or the reserved keys "input", "voice", "music" — to a file this
    /// app already staged out of its own private storage.
    private let stagedSources: [String: URL]
    private let onProgress: (Double) -> Void

    private var exportSession: AVAssetExportSession?
    private var downloadTask: URLSessionDownloadTask?
    private let cancelLock = NSLock()
    private var _cancelled = false

    private var downloaded: [URL] = []

    // ── what happened, for the person when it fails ─────────────────────────
    // The Swift half of `RenderErrorLog.java`: every step, and every failed
    // export with its full error chain (domain, code, underlying error), handed
    // back with the rejection so the studio can show the root cause.
    private let logLock = NSLock()
    private var logLines: [String] = []
    private let startedAt = Date()

    var log: [String] {
        logLock.lock(); defer { logLock.unlock() }
        return logLines
    }

    func note(_ line: String) {
        logLock.lock(); defer { logLock.unlock() }
        guard logLines.count < 80 else { return }
        let seconds = Date().timeIntervalSince(startedAt)
        logLines.append(String(format: "[%5.1fs] ", seconds) + String(line.prefix(400)))
    }

    static func chain(_ error: Error) -> String {
        var parts: [String] = []
        var current: NSError? = error as NSError
        var depth = 0
        while let nsError = current, depth < 5 {
            parts.append("\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
                + (nsError.localizedFailureReason.map { " — \($0)" } ?? ""))
            current = nsError.userInfo[NSUnderlyingErrorKey] as? NSError
            depth += 1
        }
        return parts.joined(separator: " ← caused by ")
    }

    init(
        manifest: RenderManifest,
        workDirectory: URL,
        stagedSources: [String: URL],
        onProgress: @escaping (Double) -> Void
    ) {
        self.manifest = manifest
        self.workDirectory = workDirectory
        self.stagedSources = stagedSources
        self.onProgress = onProgress
    }

    var isCancelled: Bool {
        cancelLock.lock()
        defer { cancelLock.unlock() }
        return _cancelled
    }

    /// Stop as soon as possible.
    ///
    /// Cancellation has to work mid-download, mid-still-render and mid-export,
    /// because the usual reason a phone render is cancelled is the user leaving
    /// the screen — and a render that keeps encoding after that drains a battery
    /// for nothing.
    func cancel() {
        cancelLock.lock()
        _cancelled = true
        let task = downloadTask
        let session = exportSession
        cancelLock.unlock()

        task?.cancel()
        session?.cancelExport()
    }

    /// Run the whole stage. Call from a background queue.
    func run() throws -> Result {
        var output: URL?
        note("Phone: \(UIDevice.current.model), iOS \(UIDevice.current.systemVersion)")
        note("Stage \(manifest.stage) at \(manifest.width)×\(manifest.height), \(manifest.fps) fps")
        do {
            let inputs = try fetchInputs()
            try throwIfCancelled()
            for (key, url) in inputs {
                let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size]
                    as? NSNumber)?.doubleValue ?? 0
                note(String(format: "Input %@: %.1f MB", key, size / 1_000_000))
            }

            let outputURL = workDirectory.appendingPathComponent("\(UUID().uuidString)-output.mp4")
            output = outputURL
            let renderer = ManifestRenderer(manifest: manifest, workDirectory: workDirectory)

            let resolve: ManifestRenderer.SourceResolver = { assetId in
                guard let url = inputs[assetId] else {
                    throw RenderError.missingInput("source \(assetId)")
                }
                return url
            }

            var exported = false
            let built: ManifestRenderer.Built
            switch manifest.stage {
            case .master where manifest.composesFromSources,
                 .final where manifest.composesFromSources:
                // The master or the final straight from the originals: the
                // montage's composition, the mix, and for a final the template
                // and captions — one export, nothing downloaded but the voice
                // and the music.
                let voice = try require(inputs, "voice", "the approved speaking voice")
                let music = inputs["music"]
                if manifest.audio.musicSelected && music == nil {
                    throw RenderError.missingInput("the selected background music")
                }
                let voiceLength = manifest.audio.voiceDurationSeconds
                    ?? CMTimeGetSeconds(AVURLAsset(url: voice).duration)
                // max(picture, voice + lead-in), as the server's compose step.
                let total = max(manifest.pictureSeconds,
                                voiceLength + manifest.audio.voiceLeadInSeconds)

                let mixURL = workDirectory.appendingPathComponent("\(UUID().uuidString)-mix.m4a")
                _ = try AudioMixer(spec: manifest.audio)
                    .mix(voice: voice, music: music, totalSeconds: total, output: mixURL)
                downloaded.append(mixURL)
                try throwIfCancelled()

                let picture = try renderer.buildMontage(
                    resolve: resolve,
                    isCancelled: { [weak self] in self?.isCancelled ?? true },
                    onSegmentProgress: { [weak self] fraction in
                        self?.report(Self.downloadShare * 100 + fraction * 10)
                    }
                )
                let master = try renderer.addingAudio(to: picture, mixedAudio: mixURL)
                if manifest.stage == .master {
                    built = master
                } else {
                    // The template is decoration and the captions are content:
                    // if this device will not export both, it drops the template.
                    let decorated = renderer.decorated(master, includeTemplate: true)
                    do {
                        try export(decorated, to: outputURL)
                        built = decorated
                        exported = true
                    } catch RenderError.cancelled {
                        throw RenderError.cancelled
                    } catch {
                        note("Attempt with the look (template) FAILED — \(Self.chain(error))")
                        try? FileManager.default.removeItem(at: outputURL)
                        let plain = try renderer.buildMontage(
                            resolve: resolve,
                            isCancelled: { [weak self] in self?.isCancelled ?? true },
                            onSegmentProgress: { _ in }
                        )
                        built = renderer.decorated(
                            try renderer.addingAudio(to: plain, mixedAudio: mixURL),
                            includeTemplate: false)
                        cleanup(picture.temporaryFiles)
                    }
                }

            case .montage:
                built = try renderer.buildMontage(
                    resolve: resolve,
                    isCancelled: { [weak self] in self?.isCancelled ?? true },
                    onSegmentProgress: { [weak self] fraction in
                        self?.report(Self.downloadShare * 100 + fraction * 10)
                    }
                )

            case .master:
                let montage = try require(inputs, "input", "the approved montage")
                let voice = try require(inputs, "voice", "the approved speaking voice")
                let music = inputs["music"]

                let picture = CMTimeGetSeconds(AVURLAsset(url: montage).duration)
                let voiceLength = manifest.audio.voiceDurationSeconds
                    ?? CMTimeGetSeconds(AVURLAsset(url: voice).duration)
                // The export runs for max(picture, voice + lead-in): the montage
                // normally outlasts the narration, but a voice that overruns
                // must never be clipped.
                let total = max(picture, voiceLength + manifest.audio.voiceLeadInSeconds)

                let mixURL = workDirectory.appendingPathComponent("\(UUID().uuidString)-mix.m4a")
                _ = try AudioMixer(spec: manifest.audio)
                    .mix(voice: voice, music: music, totalSeconds: total, output: mixURL)
                try throwIfCancelled()

                built = try renderer.buildMaster(montage: montage, mixedAudio: mixURL)
                downloaded.append(mixURL)

            case .final:
                let master = try require(inputs, "input", "the approved merged master")
                built = try renderer.buildFinal(master: master)
            }

            if !exported { try export(built, to: outputURL) }
            cleanup(built.temporaryFiles)
            try throwIfCancelled()

            let asset = AVURLAsset(url: outputURL)
            let size = (try? FileManager.default.attributesOfItem(atPath: outputURL.path))?[.size]
            let bytes = (size as? NSNumber)?.intValue ?? 0
            let hasAudio = !asset.tracks(withMediaType: .audio).isEmpty

            guard bytes > 0 else { throw RenderError.export("The export produced no bytes") }
            if manifest.stage != .montage && !hasAudio {
                // The specific failure that kept the draft renderer from
                // shipping. Catching it here means the phone says so, instead of
                // uploading a silent file for the server to reject.
                throw RenderError.export(
                    "The export came out silent; the approved voice was not mixed in")
            }

            var result = Result(
                output: outputURL,
                cover: nil,
                fileSizeBytes: bytes,
                durationSeconds: CMTimeGetSeconds(asset.duration),
                hasAudioTrack: hasAudio,
                width: manifest.width,
                height: manifest.height,
                stage: manifest.stage.rawValue,
                crossDissolved: manifest.stage == .montage || manifest.composesFromSources
            )

            if manifest.output.coverRequired {
                report(95)
                result.cover = try extractCover(from: asset, at: manifest.output.coverAtSeconds)
            }

            cleanupDownloads()
            report(100)
            return result
        } catch {
            note("Render FAILED — \(Self.chain(error))")
            cleanupDownloads()
            if let output { try? FileManager.default.removeItem(at: output) }
            throw error
        }
    }

    // ── inputs ──────────────────────────────────────────────────────────────

    private func require(_ inputs: [String: URL], _ key: String, _ label: String) throws -> URL {
        guard let url = inputs[key], FileManager.default.fileExists(atPath: url.path) else {
            throw RenderError.missingInput(label)
        }
        return url
    }

    /// Resolve everything the stage reads.
    ///
    /// A source with a `localId` is already on this phone — the whole point of
    /// the local-first path is that its original bytes were never uploaded, so
    /// it is used in place and never fetched. Everything else is a short-lived,
    /// object-scoped URL the server signed for this attempt.
    private func fetchInputs() throws -> [String: URL] {
        var inputs = stagedSources

        var pending: [(key: String, url: String, ext: String)] = []
        for source in manifest.sources where inputs[source.assetId] == nil {
            guard let url = source.url else {
                throw RenderError.manifest(
                    "Source \(source.assetId) is device-private but was not staged")
            }
            pending.append((source.assetId, url, Self.extension(for: source.mimeType)))
        }
        if let url = manifest.masterUrl, inputs["input"] == nil {
            pending.append(("input", url, "mp4"))
        }
        if let url = manifest.voiceUrl, inputs["voice"] == nil {
            pending.append(("voice", url, "m4a"))
        }
        if let url = manifest.musicUrl, inputs["music"] == nil {
            pending.append(("music", url, "mp3"))
        }

        for (index, item) in pending.enumerated() {
            try throwIfCancelled()
            inputs[item.key] = try fetch(item.url, label: item.key, extension: item.ext)
            report(Double(index + 1) / Double(pending.count) * Self.downloadShare * 100)
        }
        return inputs
    }

    private func fetch(_ url: String, label: String, extension ext: String) throws -> URL {
        if url.hasPrefix("file://"), let local = URL(string: url) {
            guard FileManager.default.fileExists(atPath: local.path) else {
                throw RenderError.missingInput("the staged file for \(label)")
            }
            return local
        }
        guard let remote = URL(string: url) else {
            throw RenderError.manifest("A manifest URL for \(label) is not usable")
        }

        let destination = workDirectory
            .appendingPathComponent("\(UUID().uuidString)-in-\(label).\(ext)")

        let semaphore = DispatchSemaphore(value: 0)
        var failure: Error?

        let task = URLSession.shared.downloadTask(with: remote) { temporary, response, error in
            defer { semaphore.signal() }
            if let error { failure = error; return }
            guard let temporary,
                  let status = (response as? HTTPURLResponse)?.statusCode,
                  (200...299).contains(status) else {
                failure = RenderError.export("Downloading \(label) failed")
                return
            }
            do {
                try FileManager.default.moveItem(at: temporary, to: destination)
            } catch {
                failure = error
            }
        }
        cancelLock.lock(); downloadTask = task; cancelLock.unlock()
        task.resume()
        semaphore.wait()
        cancelLock.lock(); downloadTask = nil; cancelLock.unlock()

        if let failure { throw failure }
        downloaded.append(destination)
        return destination
    }

    private static func `extension`(for mimeType: String) -> String {
        if mimeType.hasPrefix("video/") { return "mp4" }
        if mimeType.contains("png") { return "png" }
        if mimeType.contains("webp") { return "webp" }
        if mimeType.hasPrefix("image/") { return "jpg" }
        if mimeType.hasPrefix("audio/") { return "m4a" }
        return "bin"
    }

    private func cleanup(_ files: [URL]) {
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    private func cleanupDownloads() {
        // Downloaded inputs are this attempt's alone; staged local sources are
        // the user's originals and belong to the web layer, so they are never
        // touched here.
        cleanup(downloaded)
        downloaded.removeAll()
    }

    // ── export ──────────────────────────────────────────────────────────────

    private func export(_ built: ManifestRenderer.Built, to output: URL) throws {
        // `AVAssetExportPresetHighestQuality` keeps the source's resolution;
        // the video composition already pins the canvas, so quality is the only
        // axis the preset decides.
        guard let session = AVAssetExportSession(
            asset: built.asset, presetName: AVAssetExportPresetHighestQuality) else {
            throw RenderError.export("This device cannot export this composition")
        }
        session.outputURL = output
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        session.videoComposition = built.videoComposition
        session.audioMix = built.audioMix
        if let tool = built.animationTool {
            session.videoComposition?.animationTool = tool
        }

        cancelLock.lock(); exportSession = session; cancelLock.unlock()

        let timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.report(Self.downloadShare * 100 + Double(session.progress) * Self.renderShare * 100)
        }
        RunLoop.main.add(timer, forMode: .common)

        let semaphore = DispatchSemaphore(value: 0)
        session.exportAsynchronously { semaphore.signal() }
        semaphore.wait()
        timer.invalidate()

        cancelLock.lock(); exportSession = nil; cancelLock.unlock()

        switch session.status {
        case .completed:
            return
        case .cancelled:
            throw RenderError.cancelled
        default:
            if let error = session.error { note("Export FAILED — \(Self.chain(error))") }
            throw RenderError.export(
                "Export failed: \(session.error?.localizedDescription ?? "status \(session.status.rawValue)")")
        }
    }

    // ── cover ───────────────────────────────────────────────────────────────

    /// Extract the social poster from the FINISHED video.
    ///
    /// The requirement is specific and worth restating: the cover comes from the
    /// export's own frames, never from a source photo. A poster taken from an
    /// uploaded still would show something that is not in the video.
    private func extractCover(from asset: AVAsset, at seconds: Double) throws -> URL {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)

        let wanted = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
        // A video shorter than the requested time still has a first frame;
        // falling back to it beats shipping an export with no preview image
        // anywhere it is surfaced.
        let time = CMTimeCompare(wanted, asset.duration) < 0 ? wanted : .zero

        let cgImage: CGImage
        do {
            cgImage = try generator.copyCGImage(at: time, actualTime: nil)
        } catch {
            throw RenderError.export("Could not read a frame for the cover")
        }

        let destination = workDirectory.appendingPathComponent("\(UUID().uuidString)-cover.jpg")
        guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.88) else {
            throw RenderError.export("Could not encode the cover")
        }
        try data.write(to: destination)
        return destination
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private func throwIfCancelled() throws {
        if isCancelled { throw RenderError.cancelled }
    }

    private func report(_ percent: Double) {
        onProgress(min(100, max(0, percent)))
    }
}
