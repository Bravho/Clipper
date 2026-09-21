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
            "nativePluginVersion": 3,
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
                let duration = CMTime(seconds: durationSeconds, preferredTimescale: 600)
                guard CMTimeCompare(CMTimeAdd(start, duration), asset.duration) <= 0 else {
                    throw NSError(domain: "RClipper", code: 4,
                                  userInfo: [NSLocalizedDescriptionKey: "Clip trim exceeds its duration"])
                }
                let range = CMTimeRange(start: start, duration: duration)
                guard let videoTrack = composition.addMutableTrack(withMediaType: .video,
                                                                    preferredTrackID: kCMPersistentTrackID_Invalid) else {
                    throw NSError(domain: "RClipper", code: 5)
                }
                try videoTrack.insertTimeRange(range, of: sourceVideo, at: cursor)
                // preferredTransform carries the camera's portrait rotation.
                // Fill the target canvas without flattening any moving frames.
                let oriented = CGRect(origin: .zero, size: sourceVideo.naturalSize)
                    .applying(sourceVideo.preferredTransform).standardized
                guard oriented.width > 0, oriented.height > 0 else {
                    throw NSError(domain: "RClipper", code: 6)
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
                        self.fail(call, "Local timeline export failed", session.error)
                    }
                }
            }
        } catch {
            fail(call, "Could not compose the local clips", error)
        }
    }

    private func renderDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("device-render", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func validStagedSource(_ url: URL) -> Bool {
        guard let directory = try? renderDirectory() else { return false }
        return url.standardizedFileURL.deletingLastPathComponent() == directory.standardizedFileURL &&
            url.lastPathComponent.hasSuffix("-source.bin")
    }

    @objc public func beginLocalSource(_ call: CAPPluginCall) {
        guard stagedSourceURL == nil else { call.reject("A local source is already being staged"); return }
        do {
            let url = try renderDirectory().appendingPathComponent("\(UUID().uuidString)-source.bin")
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
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
        call.resolve(["sourceUrl": url.absoluteString, "fileSizeBytes": size])
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
        guard file.deletingLastPathComponent() == directory,
              file.lastPathComponent.hasSuffix("-output.mp4") else {
            call.reject("Invalid output path")
            return
        }
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.removeItem(at: file)
            }
            call.resolve()
        } catch {
            call.reject("Could not remove output file", nil, error)
        }
    }
}
