import AVFoundation
import Capacitor
import Foundation

/// First native rendering primitive: download a completed master and encode it locally.
@objc(DeviceVideoRenderPlugin)
public class DeviceVideoRenderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceVideoRenderPlugin"
    public let jsName = "DeviceVideoRender"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginLocalSource", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendLocalSource", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishLocalSource", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abortLocalSource", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseLocalSource", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderMaster", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderLocalTimeline", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderAudioDraft", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "makePreviewProxy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderManifest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "uploadOutput", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseOutput", returnType: CAPPluginReturnPromise)
    ]

    private var exportSession: AVAssetExportSession?
    private var downloadTask: URLSessionDownloadTask?
    private var activeCall: CAPPluginCall?
    private var inputURL: URL?
    private var outputURL: URL?
    private var progressTimer: Timer?
    private var stagedSourceURL: URL?

    @objc public func capabilities(_ call: CAPPluginCall) {
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let values = try? cache.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        call.resolve([
            // v5 adds renderManifest/uploadOutput: the complete phone editor
            // path. The web layer checks this before offering to render a real
            // job, so an installed v4 build keeps working as a local draft
            // tester and is never handed production work it cannot finish.
            // v6 renders a master or final straight from the originals in one
            // export (`buildFromSources`) and draws the styled render's
            // templates and captions (remotion/TemplatedVideo.tsx). The server
            // sends a from-sources manifest only to 6+, so a v5 build keeps the
            // download path.
            "nativePluginVersion": 6,
            "freeBytes": values?.volumeAvailableCapacityForImportantUsage ?? 0,
            "supportsH264Encode": true,
            "supportsAacEncode": true
        ])
    }

    @objc public func renderMaster(_ call: CAPPluginCall) {
        guard let raw = call.getString("sourceUrl"),
              let source = URL(string: raw), source.scheme == "https" || source.isFileURL else {
            call.reject("A HTTPS or staged file URL is required")
            return
        }
        guard exportSession == nil && downloadTask == nil else {
            call.reject("Another device render is already active")
            return
        }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("device-render", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            call.reject("Cannot create render directory", nil, error)
            return
        }
        let id = UUID().uuidString
        let localInput = directory.appendingPathComponent("\(id)-input.mp4")
        let localOutput = directory.appendingPathComponent("\(id)-output.mp4")
        inputURL = localInput
        outputURL = localOutput
        activeCall = call

        if source.isFileURL {
            do {
                guard validStagedSource(source) else { throw NSError(domain: "RClipper", code: 1) }
                try FileManager.default.copyItem(at: source, to: localInput)
                startExport(input: localInput, output: localOutput, call: call)
            } catch {
                fail(call, "Could not prepare local video", error)
            }
            return
        }

        downloadTask = URLSession.shared.downloadTask(with: source) { [weak self] temporaryURL, response, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard self.activeCall === call else { return }
                self.downloadTask = nil
                if let error = error {
                    self.fail(call, "Could not download video", error)
                    return
                }
                guard let temporaryURL = temporaryURL,
                      let status = (response as? HTTPURLResponse)?.statusCode,
                      (200...299).contains(status) else {
                    self.fail(call, "Video download failed", nil)
                    return
                }
                do {
                    try FileManager.default.moveItem(at: temporaryURL, to: localInput)
                } catch {
                    self.fail(call, "Could not store video for rendering", error)
                    return
                }
                self.startExport(input: localInput, output: localOutput, call: call)
            }
        }
        downloadTask?.resume()
    }

    /// Join real staged video tracks on the phone. Material clip audio is
    /// deliberately omitted; the approved voice and music are mixed later.
    @objc public func renderLocalTimeline(_ call: CAPPluginCall) {
        guard exportSession == nil && downloadTask == nil && activeCall == nil else {
            call.reject("Another device render is already active")
            return
        }
        guard let clips = call.getArray("clips") as? [JSObject], !clips.isEmpty, clips.count <= 10,
              let width = call.getInt("width"), let height = call.getInt("height"),
              width > 0, height > 0, width <= 1920, height <= 1920 else {
            call.reject("Invalid local timeline")
            return
        }

        let composition = AVMutableComposition()
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = CGSize(width: width, height: height)
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        var instructions: [AVMutableVideoCompositionInstruction] = []
        var cursor = CMTime.zero

        do {
            for clip in clips {
                guard let raw = clip["sourceUrl"] as? String,
                      let url = URL(string: raw), url.isFileURL, validStagedSource(url),
                      let startSeconds = clip["startSeconds"] as? Double,
                      let durationSeconds = clip["durationSeconds"] as? Double,
                      startSeconds >= 0, durationSeconds > 0,
                      startSeconds.isFinite, durationSeconds.isFinite else {
                    throw NSError(domain: "RClipper", code: 2,
                                  userInfo: [NSLocalizedDescriptionKey: "Invalid staged clip or trim"])
                }
                let asset = AVURLAsset(url: url)
                guard let sourceVideo = asset.tracks(withMediaType: .video).first else {
                    throw NSError(domain: "RClipper", code: 3,
                                  userInfo: [NSLocalizedDescriptionKey: "A source has no video track"])
                }
                let start = CMTime(seconds: startSeconds, preferredTimescale: 600)
                let requested = CMTime(seconds: durationSeconds, preferredTimescale: 600)
                // Browser-reported durations and CMTime rounding can overshoot
                // the real track by a frame; clamp rather than fail the render.
                let available = CMTimeSubtract(sourceVideo.timeRange.end, start)
                let duration = CMTimeMinimum(requested, available)
                guard CMTimeCompare(duration, CMTime(value: 1, timescale: 30)) >= 0 else {
                    throw NSError(domain: "RClipper", code: 4,
                                  userInfo: [NSLocalizedDescriptionKey: "Clip trim starts past the end of its video"])
                }
                let range = CMTimeRange(start: start, duration: duration)
                guard let videoTrack = composition.addMutableTrack(withMediaType: .video,
                                                                    preferredTrackID: kCMPersistentTrackID_Invalid) else {
                    throw NSError(domain: "RClipper", code: 5,
                                  userInfo: [NSLocalizedDescriptionKey: "Could not add a timeline track"])
                }
                try videoTrack.insertTimeRange(range, of: sourceVideo, at: cursor)
                // preferredTransform carries the camera's portrait rotation.
                // Fill the target canvas without flattening any moving frames.
                let oriented = CGRect(origin: .zero, size: sourceVideo.naturalSize)
                    .applying(sourceVideo.preferredTransform).standardized
                guard oriented.width > 0, oriented.height > 0 else {
                    throw NSError(domain: "RClipper", code: 6,
                                  userInfo: [NSLocalizedDescriptionKey: "A source has an empty video frame"])
                }
                let scale = max(CGFloat(width) / oriented.width, CGFloat(height) / oriented.height)
                let transform = sourceVideo.preferredTransform
                    .concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
                    .concatenating(CGAffineTransform(scaleX: scale, y: scale))
                    .concatenating(CGAffineTransform(
                        translationX: (CGFloat(width) - oriented.width * scale) / 2,
                        y: (CGFloat(height) - oriented.height * scale) / 2
                    ))
                let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
                layer.setTransform(transform, at: cursor)
                let instruction = AVMutableVideoCompositionInstruction()
                instruction.timeRange = CMTimeRange(start: cursor, duration: duration)
                instruction.layerInstructions = [layer]
                instructions.append(instruction)
                cursor = CMTimeAdd(cursor, duration)
            }

            videoComposition.instructions = instructions
            let output = try renderDirectory().appendingPathComponent("\(UUID().uuidString)-output.mp4")
            outputURL = output
            activeCall = call
            guard let session = AVAssetExportSession(asset: composition,
                                                      presetName: AVAssetExportPresetHighestQuality) else {
                throw NSError(domain: "RClipper", code: 7,
                              userInfo: [NSLocalizedDescriptionKey: "Timeline export is unavailable"])
            }
            session.videoComposition = videoComposition
            session.outputURL = output
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            exportSession = session
            progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                guard let self = self, self.exportSession === session else { return }
                self.notifyListeners("renderProgress", data: ["percent": Int(session.progress * 100)])
            }
            session.exportAsynchronously { [weak self] in
                DispatchQueue.main.async {
                    guard let self = self, self.activeCall === call else { return }
                    self.exportSession = nil
                    self.stopProgressTimer()
                    if session.status == .completed {
                        let attributes = try? FileManager.default.attributesOfItem(atPath: output.path)
                        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
                        self.activeCall = nil
                        call.resolve(["path": output.path, "fileSizeBytes": size])
                    } else {
                        let reason = session.error?.localizedDescription ?? "status \(session.status.rawValue)"
                        self.fail(call, "Local timeline export failed: \(reason)", session.error)
                    }
                }
            }
        } catch {
            fail(call, "Could not compose the local clips: \(error.localizedDescription)", error)
        }
    }

    /// v6: a light 720p H.264 preview copy of a staged clip, for the in-app
    /// browser when it cannot play what the camera recorded. Preview only: the
    /// original is what gets rendered.
    @objc public func makePreviewProxy(_ call: CAPPluginCall) {
        guard exportSession == nil && downloadTask == nil && activeCall == nil else {
            call.reject("Another device render is already active")
            return
        }
        guard let raw = call.getString("sourceUrl"), let source = URL(string: raw),
              source.isFileURL, validStagedSource(source) else {
            call.reject("A staged clip is required")
            return
        }
        do {
            let output = try renderDirectory().appendingPathComponent("\(UUID().uuidString)-output.mp4")
            let asset = AVURLAsset(url: source)
            guard let session = AVAssetExportSession(
                asset: asset, presetName: AVAssetExportPreset1280x720) else {
                call.reject("This phone cannot make a preview copy of this clip")
                return
            }
            session.outputURL = output
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            outputURL = output
            activeCall = call
            exportSession = session
            session.exportAsynchronously { [weak self] in
                DispatchQueue.main.async {
                    guard let self = self, self.activeCall === call else { return }
                    self.exportSession = nil
                    if session.status == .completed {
                        let attributes = try? FileManager.default.attributesOfItem(atPath: output.path)
                        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
                        self.activeCall = nil
                        call.resolve(["path": output.path, "fileSizeBytes": size])
                    } else {
                        let reason = session.error?.localizedDescription ?? "status \(session.status.rawValue)"
                        self.fail(call, "Preview copy failed: \(reason)", session.error)
                    }
                }
            }
        } catch {
            fail(call, "Could not make a preview copy: \(error.localizedDescription)", error)
        }
    }

    /// Adds a speaking voice and optional looping music to the local montage.
    /// This is an audible draft; loudness normalization and ducking remain separate work.
    @objc public func renderAudioDraft(_ call: CAPPluginCall) {
        guard exportSession == nil && downloadTask == nil && activeCall == nil else {
            call.reject("Another device render is already active")
            return
        }
        guard let masterPath = call.getString("masterPath"),
              let voiceRaw = call.getString("voiceUrl"),
              let voiceURL = URL(string: voiceRaw), voiceURL.isFileURL,
              validStagedSource(voiceURL) else {
            call.reject("A local montage and staged speaking voice are required")
            return
        }
        do {
            let directory = try renderDirectory().standardizedFileURL
            let masterURL = URL(fileURLWithPath: masterPath).standardizedFileURL
            guard masterURL.deletingLastPathComponent() == directory,
                  masterURL.lastPathComponent.hasSuffix("-output.mp4") else {
                throw NSError(domain: "RClipper", code: 8,
                              userInfo: [NSLocalizedDescriptionKey: "Invalid local montage"])
            }
            let master = AVURLAsset(url: masterURL)
            guard let sourceVideo = master.tracks(withMediaType: .video).first else {
                throw NSError(domain: "RClipper", code: 9,
                              userInfo: [NSLocalizedDescriptionKey: "Montage has no video track"])
            }
            let duration = master.duration
            guard CMTimeCompare(duration, CMTime(seconds: 0.7, preferredTimescale: 600)) > 0 else {
                throw NSError(domain: "RClipper", code: 10,
                              userInfo: [NSLocalizedDescriptionKey: "Montage is too short for voice lead-in"])
            }
            let composition = AVMutableComposition()
            guard let videoTrack = composition.addMutableTrack(withMediaType: .video,
                                                               preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw NSError(domain: "RClipper", code: 11,
                              userInfo: [NSLocalizedDescriptionKey: "Could not add montage track"])
            }
            try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration),
                                           of: sourceVideo, at: .zero)
            videoTrack.preferredTransform = sourceVideo.preferredTransform

            let voiceAsset = AVURLAsset(url: voiceURL)
            guard let sourceVoice = voiceAsset.tracks(withMediaType: .audio).first,
                  let voiceTrack = composition.addMutableTrack(withMediaType: .audio,
                                                                 preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw NSError(domain: "RClipper", code: 12,
                              userInfo: [NSLocalizedDescriptionKey: "Speaking voice has no audio track"])
            }
            let lead = CMTime(seconds: 0.6, preferredTimescale: 600)
            let voiceDuration = CMTimeMinimum(sourceVoice.timeRange.duration, CMTimeSubtract(duration, lead))
            try voiceTrack.insertTimeRange(CMTimeRange(start: .zero, duration: voiceDuration),
                                           of: sourceVoice, at: lead)

            let audioMix = AVMutableAudioMix()
            if let musicRaw = call.getString("musicUrl") {
                guard let musicURL = URL(string: musicRaw), musicURL.isFileURL,
                      validStagedSource(musicURL),
                      let sourceMusic = AVURLAsset(url: musicURL).tracks(withMediaType: .audio).first,
                      CMTimeCompare(sourceMusic.timeRange.duration, .zero) > 0,
                      let musicTrack = composition.addMutableTrack(withMediaType: .audio,
                                                                    preferredTrackID: kCMPersistentTrackID_Invalid) else {
                    throw NSError(domain: "RClipper", code: 13,
                                  userInfo: [NSLocalizedDescriptionKey: "Selected music has no audio track"])
                }
                var cursor = CMTime.zero
                while CMTimeCompare(cursor, duration) < 0 {
                    let segment = CMTimeMinimum(sourceMusic.timeRange.duration, CMTimeSubtract(duration, cursor))
                    try musicTrack.insertTimeRange(CMTimeRange(start: .zero, duration: segment),
                                                   of: sourceMusic, at: cursor)
                    cursor = CMTimeAdd(cursor, segment)
                }
                let musicParams = AVMutableAudioMixInputParameters(track: musicTrack)
                musicParams.setVolume(0.3, at: .zero)
                audioMix.inputParameters = [musicParams]
            }
            let output = directory.appendingPathComponent("\(UUID().uuidString)-output.mp4")
            outputURL = output
            activeCall = call
            guard let session = AVAssetExportSession(asset: composition,
                                                      presetName: AVAssetExportPresetHighestQuality) else {
                throw NSError(domain: "RClipper", code: 14,
                              userInfo: [NSLocalizedDescriptionKey: "Audio draft export is unavailable"])
            }
            session.outputURL = output
            session.outputFileType = .mp4
            session.audioMix = audioMix
            session.shouldOptimizeForNetworkUse = true
            exportSession = session
            progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                guard let self = self, self.exportSession === session else { return }
                self.notifyListeners("renderProgress", data: ["percent": Int(session.progress * 100)])
            }
            session.exportAsynchronously { [weak self] in
                DispatchQueue.main.async {
                    guard let self = self, self.activeCall === call else { return }
                    self.exportSession = nil
                    self.stopProgressTimer()
                    if session.status == .completed {
                        let attributes = try? FileManager.default.attributesOfItem(atPath: output.path)
                        self.activeCall = nil
                        call.resolve(["path": output.path,
                                      "fileSizeBytes": (attributes?[.size] as? NSNumber)?.int64Value ?? 0])
                    } else {
                        self.fail(call, "Audio draft export failed", session.error)
                    }
                }
            }
        } catch {
            fail(call, "Could not compose audible draft: \(error.localizedDescription)", error)
        }
    }

    // ── v5: the complete manifest render path ───────────────────────────────

    /// The manifest render in flight, so cancel() can reach it.
    private var activeManifestJob: ManifestJob?
    /// Outputs a manifest render produced, kept until the web layer releases them.
    private var manifestOutputs: [String: URL] = [:]
    /// Manifest renders run here so the WebView thread is never blocked by an
    /// export that can take minutes.
    private let renderQueue = DispatchQueue(label: "com.rclipper.manifestrender")

    /// Render one stage of a server-issued manifest.
    ///
    /// `stagedSources` maps a manifest source's assetId — or the reserved keys
    /// "input", "voice" and "music" — to a file this plugin already staged. That
    /// is how device-private originals reach the renderer without ever being
    /// uploaded: the web layer copies them out of its private storage into the
    /// plugin's cache, and the manifest names them by `localId` instead of a URL.
    @objc public func renderManifest(_ call: CAPPluginCall) {
        guard let json = call.getString("manifest") else {
            call.reject("A render manifest is required")
            return
        }
        guard exportSession == nil, downloadTask == nil, activeCall == nil,
              activeManifestJob == nil else {
            call.reject("Another device render is already active")
            return
        }

        let manifest: RenderManifest
        do {
            manifest = try RenderManifest.parse(json)
        } catch {
            call.reject("This render manifest cannot be rendered by this app build", nil, error)
            return
        }

        var staged: [String: URL] = [:]
        if let entries = call.getArray("stagedSources") as? [JSObject] {
            for entry in entries {
                guard let key = entry["key"] as? String,
                      let raw = entry["sourceUrl"] as? String,
                      let url = URL(string: raw), url.isFileURL, validRenderInput(url) else {
                    call.reject("A staged source path is not valid")
                    return
                }
                staged[key] = url
            }
        }

        let directory: URL
        do {
            directory = try renderDirectory()
        } catch {
            call.reject("Cannot create render directory", nil, error)
            return
        }

        activeCall = call
        let job = ManifestJob(
            manifest: manifest,
            workDirectory: directory,
            stagedSources: staged
        ) { [weak self] percent in
            self?.notifyListeners("renderProgress", data: ["percent": percent])
        }
        activeManifestJob = job

        renderQueue.async { [weak self] in
            guard let self else { return }
            do {
                let result = try job.run()
                DispatchQueue.main.async {
                    self.activeManifestJob = nil
                    guard self.activeCall === call else {
                        try? FileManager.default.removeItem(at: result.output)
                        return
                    }
                    self.activeCall = nil
                    self.manifestOutputs[result.output.path] = result.output

                    var response: [String: Any] = [
                        "path": result.output.path,
                        "fileSizeBytes": result.fileSizeBytes,
                        "durationSeconds": result.durationSeconds,
                        "hasAudioTrack": result.hasAudioTrack,
                        "width": result.width,
                        "height": result.height,
                        "stage": result.stage,
                        // Reported so a comparison against the Mac export is
                        // never guesswork.
                        "crossDissolved": result.crossDissolved,
                    ]
                    if let cover = result.cover {
                        self.manifestOutputs[cover.path] = cover
                        response["coverPath"] = cover.path
                    }
                    call.resolve(response)
                }
            } catch {
                DispatchQueue.main.async {
                    self.activeManifestJob = nil
                    guard self.activeCall === call else { return }
                    self.activeCall = nil
                    call.reject(error.localizedDescription, nil, error)
                }
            }
        }
    }

    /// Upload a finished render straight to object storage.
    ///
    /// The part URLs are presigned by the server for the one key this attempt
    /// was given, so the phone cannot choose where its export lands.
    @objc public func uploadOutput(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              let partUrls = call.getArray("partUrls") as? [String], !partUrls.isEmpty,
              let partSize = call.getInt("partSizeBytes"), partSize > 0 else {
            call.reject("An output path and presigned part URLs are required")
            return
        }
        let coverPath = call.getString("coverPath")
        let coverUrl = call.getString("coverUrl")

        renderQueue.async { [weak self] in
            guard let self else { return }
            do {
                let directory = try self.renderDirectory().standardizedFileURL
                let output = URL(fileURLWithPath: path).standardizedFileURL
                guard output.deletingLastPathComponent() == directory,
                      FileManager.default.fileExists(atPath: output.path) else {
                    throw RenderError.export("Invalid output path")
                }

                let parts = try Uploads.uploadParts(
                    file: output,
                    partUrls: partUrls,
                    partSizeBytes: partSize,
                    workDirectory: directory
                ) { fraction in
                    self.notifyListeners("uploadProgress", data: ["percent": fraction * 100])
                }

                if let coverPath, let coverUrl {
                    let cover = URL(fileURLWithPath: coverPath).standardizedFileURL
                    if cover.deletingLastPathComponent() == directory,
                       FileManager.default.fileExists(atPath: cover.path) {
                        try Uploads.put(file: cover, to: coverUrl, contentType: "image/jpeg")
                    }
                }

                let encoded = parts.map { ["partNumber": $0.partNumber, "eTag": $0.eTag] }
                DispatchQueue.main.async { call.resolve(["parts": encoded]) }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Could not upload the rendered video", nil, error)
                }
            }
        }
    }

    private func renderDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("device-render", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// A file a manifest render may read: a staged copy of a device-private
    /// original, OR a previous stage's output being chained into the next one.
    ///
    /// Both live in this plugin's render directory and nowhere else, which is
    /// the guarantee worth keeping — the file NAME is a convenience, the parent
    /// directory check is the security boundary.
    private func validRenderInput(_ url: URL) -> Bool {
        guard let directory = try? renderDirectory() else { return false }
        guard url.standardizedFileURL.deletingLastPathComponent()
            == directory.standardizedFileURL else { return false }
        let name = url.lastPathComponent
        if DeviceVideoRenderPlugin.stagedSourceSuffixes.contains(where: { name.hasSuffix($0) }) {
            return true
        }
        return name.hasSuffix("-output.mp4") || name.hasSuffix("-mix.m4a")
    }

    private func validStagedSource(_ url: URL) -> Bool {
        guard let directory = try? renderDirectory() else { return false }
        let name = url.lastPathComponent
        return url.standardizedFileURL.deletingLastPathComponent() == directory.standardizedFileURL &&
            DeviceVideoRenderPlugin.stagedSourceSuffixes.contains { name.hasSuffix($0) }
    }

    /// AVURLAsset picks its container parser from the file extension; a
    /// `.bin` file opens with zero tracks. Staged sources are renamed to a
    /// real media extension once their bytes are complete.
    private static let stagedSourceSuffixes = ["-source.bin", "-source.mp4", "-source.mov", "-source.mp3", "-source.m4a", "-source.wav"]

    private func mediaExtension(for url: URL) -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return "mov" }
        defer { try? handle.close() }
        let header = handle.readData(ofLength: 12)
        guard header.count == 12,
              String(data: header.subdata(in: 4..<8), encoding: .ascii) == "ftyp" else {
            // Legacy QuickTime files may start with moov/mdat/wide atoms.
            return "mov"
        }
        let brand = String(data: header.subdata(in: 8..<12), encoding: .ascii)
        return brand == "qt  " ? "mov" : "mp4"
    }

    @objc public func beginLocalSource(_ call: CAPPluginCall) {
        guard stagedSourceURL == nil else { call.reject("A local source is already being staged"); return }
        do {
            let mediaExtension = call.getString("extension") ?? "bin"
            guard ["bin", "mp3", "m4a", "wav", "mp4"].contains(mediaExtension) else {
                call.reject("Unsupported staged media type")
                return
            }
            let url = try renderDirectory().appendingPathComponent("\(UUID().uuidString)-source.\(mediaExtension)")
            FileManager.default.createFile(atPath: url.path, contents: nil)
            stagedSourceURL = url
            call.resolve()
        } catch { call.reject("Could not begin local source", nil, error) }
    }

    @objc public func appendLocalSource(_ call: CAPPluginCall) {
        guard let url = stagedSourceURL,
              let encoded = call.getString("dataBase64"),
              let data = Data(base64Encoded: encoded) else {
            call.reject("No active local source")
            return
        }
        do {
            let handle = try FileHandle(forWritingTo: url)
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.close()
            call.resolve()
        } catch { call.reject("Could not append local source", nil, error) }
    }

    @objc public func finishLocalSource(_ call: CAPPluginCall) {
        guard let url = stagedSourceURL else { call.reject("No active local source"); return }
        stagedSourceURL = nil
        let typed = url.pathExtension == "bin"
            ? url.deletingPathExtension().appendingPathExtension(mediaExtension(for: url))
            : url
        do {
            if typed != url { try FileManager.default.moveItem(at: url, to: typed) }
        } catch {
            try? FileManager.default.removeItem(at: url)
            call.reject("Could not finish local source", nil, error)
            return
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: typed.path)
        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
        call.resolve(["sourceUrl": typed.absoluteString, "fileSizeBytes": size])
    }

    @objc public func abortLocalSource(_ call: CAPPluginCall) {
        if let url = stagedSourceURL { try? FileManager.default.removeItem(at: url) }
        stagedSourceURL = nil
        call.resolve()
    }

    @objc public func releaseLocalSource(_ call: CAPPluginCall) {
        guard let raw = call.getString("sourceUrl"), let url = URL(string: raw), validStagedSource(url) else {
            call.reject("Invalid staged source path")
            return
        }
        do {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            call.resolve()
        } catch { call.reject("Could not release local source", nil, error) }
    }

    private func startExport(input: URL, output: URL, call: CAPPluginCall) {
        let asset = AVURLAsset(url: input)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
            clearFiles(includeOutput: true)
            call.reject("This video cannot be exported on this device")
            return
        }
        session.outputURL = output
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        exportSession = session
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, self.exportSession === session else { return }
            self.notifyListeners("renderProgress", data: ["percent": Int(session.progress * 100)])
        }
        session.exportAsynchronously { [weak self] in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard self.activeCall === call else { return }
                self.exportSession = nil
                self.stopProgressTimer()
                if session.status == .completed {
                    let attributes = try? FileManager.default.attributesOfItem(atPath: output.path)
                    let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
                    self.clearFiles(includeOutput: false)
                    self.activeCall = nil
                    call.resolve(["path": output.path, "fileSizeBytes": size])
                } else {
                    self.fail(call, "Device video export failed", session.error)
                }
            }
        }
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        // A manifest job may be mid-download, mid-still-render or mid-export on
        // the render queue; it is told to stop first, so a cancelled render
        // stops encoding rather than finishing in the background and draining
        // the battery for an output nobody wants.
        activeManifestJob?.cancel()
        activeManifestJob = nil

        let renderCall = activeCall
        activeCall = nil
        downloadTask?.cancel()
        exportSession?.cancelExport()
        stopProgressTimer()
        downloadTask = nil
        exportSession = nil
        clearFiles(includeOutput: true)
        renderCall?.reject("Device render cancelled")
        call.resolve()
    }

    private func fail(_ call: CAPPluginCall, _ message: String, _ error: Error?) {
        activeCall = nil
        stopProgressTimer()
        clearFiles(includeOutput: true)
        call.reject(message, nil, error)
    }

    private func clearFiles(includeOutput: Bool) {
        if let inputURL = inputURL { try? FileManager.default.removeItem(at: inputURL) }
        if includeOutput, let outputURL = outputURL { try? FileManager.default.removeItem(at: outputURL) }
        inputURL = nil
        if includeOutput { outputURL = nil }
    }

    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    @objc public func releaseOutput(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing output path")
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("device-render", isDirectory: true).standardizedFileURL
        let file = URL(fileURLWithPath: path).standardizedFileURL
        let isRenderOutput = file.lastPathComponent.hasSuffix("-output.mp4")
            || file.lastPathComponent.hasSuffix("-cover.jpg")
        guard file.deletingLastPathComponent() == directory, isRenderOutput else {
            call.reject("Invalid output path")
            return
        }
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.removeItem(at: file)
            }
            manifestOutputs.removeValue(forKey: file.path)
            call.resolve()
        } catch {
            call.reject("Could not remove output file", nil, error)
        }
    }
}
