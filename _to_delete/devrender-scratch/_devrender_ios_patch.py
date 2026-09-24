import io

p = "ios/App/App/DeviceVideoRenderPlugin.swift"
s = io.open(p, encoding="utf-8").read()

# ── 1. register the new methods ─────────────────────────────────────────────
old = '''        CAPPluginMethod(name: "renderAudioDraft", returnType: CAPPluginReturnPromise),'''
assert s.count(old) == 1, "method list anchor"
new = '''        CAPPluginMethod(name: "renderAudioDraft", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderManifest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "uploadOutput", returnType: CAPPluginReturnPromise),'''
s = s.replace(old, new, 1)

# ── 2. version bump ─────────────────────────────────────────────────────────
old = '''            "nativePluginVersion": 4,'''
assert s.count(old) == 1, "version anchor"
new = '''            // v5 adds renderManifest/uploadOutput: the complete phone editor
            // path. The web layer checks this before offering to render a real
            // job, so an installed v4 build keeps working as a local draft
            // tester and is never handed production work it cannot finish.
            "nativePluginVersion": 5,'''
s = s.replace(old, new, 1)

# ── 3. new state + methods, inserted before renderDirectory() ───────────────
anchor = '''    private func renderDirectory() throws -> URL {'''
assert s.count(anchor) == 1, "renderDirectory anchor"

addition = '''    // ── v5: the complete manifest render path ───────────────────────────────

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
                      let url = URL(string: raw), url.isFileURL, validStagedSource(url) else {
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

'''

s = s.replace(anchor, addition + anchor, 1)

# ── 4. cancel() must also stop a manifest job ───────────────────────────────
old = '''    @objc public func cancel(_ call: CAPPluginCall) {
        let renderCall = activeCall
        activeCall = nil'''
assert s.count(old) == 1, "cancel anchor"
new = '''    @objc public func cancel(_ call: CAPPluginCall) {
        // A manifest job may be mid-download, mid-still-render or mid-export on
        // the render queue; it is told to stop first, so a cancelled render
        // stops encoding rather than finishing in the background and draining
        // the battery for an output nobody wants.
        activeManifestJob?.cancel()
        activeManifestJob = nil

        let renderCall = activeCall
        activeCall = nil'''
s = s.replace(old, new, 1)

# ── 5. releaseOutput must accept a cover JPEG and forget the output ─────────
old = '''        guard file.deletingLastPathComponent() == directory,
              file.lastPathComponent.hasSuffix("-output.mp4") else {
            call.reject("Invalid output path")
            return
        }
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.removeItem(at: file)
            }
            call.resolve()'''
assert s.count(old) == 1, "releaseOutput anchor"
new = '''        let isRenderOutput = file.lastPathComponent.hasSuffix("-output.mp4")
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
            call.resolve()'''
s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("iOS plugin patched")
