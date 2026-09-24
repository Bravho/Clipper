import Foundation
import UIKit

/// The server's render manifest, decoded.
///
/// The Swift half of `src/lib/mobile/deviceRenderContract.ts`, and the exact
/// counterpart of Android's `RenderManifest.java`. Kept strict on purpose: a
/// field the manifest must carry is non-optional, so a manifest this build
/// half-understands fails to decode rather than producing a video that looks
/// nearly right.
struct RenderManifest: Decodable {

    static let supportedVersion = 4

    enum Stage: String, Decodable {
        /// Approved photos and clips become one silent intermediate.
        case montage
        /// That montage plus the mixed voice and ducked music.
        case master
        /// That master with the template and captions burned in, plus a cover.
        case final
    }

    enum Motion: String, Decodable {
        case kenBurnsIn = "ken_burns_in"
        case kenBurnsOut = "ken_burns_out"
        case panLeft = "pan_left"
        case panRight = "pan_right"
        case staticFrame = "static"
    }

    enum Transition: String, Decodable {
        case cut, fade, slide, zoom
    }

    struct Source: Decodable {
        let assetId: String
        /// "image" or "clip".
        let kind: String
        /// Exactly one of url / localId is present.
        let url: String?
        let localId: String?
        let mimeType: String
        let durationSeconds: Double?

        var isImage: Bool { kind == "image" }
    }

    struct Shot: Decodable {
        let sourceAssetId: String
        /// The slot this shot occupies before any dissolve overlap.
        let durationSeconds: Double
        let motion: Motion
        let trimStartSeconds: Double?
        let trimEndSeconds: Double?
        let focusX: Double
        let focusY: Double
        /// 0 = whole picture, 1 = fill the frame. Absent from an older plan,
        /// which means fill — what every render did before it existed.
        let frameZoom: Double?
        let playbackRate: Double

        var zoom: Double { min(1, max(0, frameZoom ?? 1)) }
    }

    struct Scene: Decodable {
        let sceneNumber: Int
        let transitionIn: Transition
        let shotTransitionSeconds: Double
        let assets: [Shot]
    }

    /// Every number the mixer needs; see `deviceRenderAudio.ts` for the why.
    struct AudioSpec: Decodable {
        let sourceClipAudio: Bool
        let musicSelected: Bool
        let sampleRate: Int
        let voiceLeadInSeconds: Double
        let musicBedVolume: Double
        let musicDuckRatio: Double
        let musicDuckThreshold: Double
        let musicDuckAttackMs: Double
        let musicDuckReleaseMs: Double
        let voiceTargetLufs: Double
        let voiceTruePeakDb: Double
        let voiceMaxGainDb: Double
        let mixLimit: Double
        let voiceDurationSeconds: Double?
    }

    struct Caption: Decodable {
        let startSeconds: Double
        let endSeconds: Double
        let textThai: String
        let textEnglish: String
        let textChinese: String

        func text(for language: String) -> String {
            switch language {
            case "th": return textThai
            case "en": return textEnglish
            case "zh": return textChinese
            default: return ""
            }
        }
    }

    struct Palette: Decodable {
        let primary: String
        let secondary: String
        let accent: String
        let neutral: String
    }

    struct Template: Decodable {
        let id: String
        let frame: String
        let canvas: String
        let decor: [String]
        let palette: Palette
    }

    struct Output: Decodable {
        let mimeType: String
        let videoCodec: String
        let audioCodec: String?
        let maxBytes: Int
        let coverRequired: Bool
        let coverAtSeconds: Double
    }

    let version: Int
    let attemptId: String
    let taskId: String
    let jobId: String
    let requestId: String
    let step: String
    let stage: Stage
    let travy: Bool
    let ratio: String
    let width: Int
    let height: Int
    let fps: Int
    let sceneTransitionSeconds: Double
    let sources: [Source]
    let scenes: [Scene]
    /// The montage for a master render, the master for a final render.
    let masterUrl: String?
    let voiceUrl: String?
    let musicUrl: String?
    let audio: AudioSpec
    let captions: [Caption]
    let captionLanguages: [String]
    let template: Template
    let output: Output
    /// Render this master or final straight from the originals in ONE export
    /// (plugin version 6+). Absent on older manifests, hence optional.
    let buildFromSources: Bool?

    var composesFromSources: Bool { buildFromSources ?? false }

    static func parse(_ json: String) throws -> RenderManifest {
        guard let data = json.data(using: .utf8) else {
            throw RenderError.manifest("The render manifest is not valid UTF-8")
        }
        let manifest = try JSONDecoder().decode(RenderManifest.self, from: data)
        guard manifest.version == supportedVersion else {
            throw RenderError.manifest(
                "This app build renders manifest v\(supportedVersion), not v\(manifest.version)")
        }
        guard manifest.width > 0, manifest.height > 0, manifest.fps > 0 else {
            throw RenderError.manifest("The manifest has an invalid canvas")
        }
        if manifest.stage == .montage && manifest.scenes.isEmpty {
            throw RenderError.manifest("A montage manifest has no scenes")
        }
        if manifest.stage != .montage && manifest.masterUrl == nil && manifest.scenes.isEmpty {
            throw RenderError.manifest("Nothing to render from")
        }
        if manifest.composesFromSources && (manifest.scenes.isEmpty || manifest.sources.isEmpty) {
            throw RenderError.manifest("A render from sources needs its scenes and sources")
        }
        if manifest.composesFromSources && manifest.stage != .montage && manifest.voiceUrl == nil {
            throw RenderError.manifest("A render from sources needs the approved voice")
        }
        return manifest
    }

    var canvasSize: CGSize { CGSize(width: width, height: height) }

    /// Total picture length: every slot end to end (dissolves borrow, never add).
    var pictureSeconds: Double {
        scenes.reduce(0) { total, scene in total + scene.assets.reduce(0) { $0 + $1.durationSeconds } }
    }

    func source(for shot: Shot) throws -> Source {
        guard let source = sources.first(where: { $0.assetId == shot.sourceAssetId }) else {
            throw RenderError.manifest("A shot refers to a source the manifest does not carry")
        }
        return source
    }

    /// Every shot in render order, flattened across scenes.
    var flattenedShots: [Shot] { scenes.flatMap { $0.assets } }

    /// The scene a flat shot index belongs to, for its transition flourish.
    func scene(forFlatIndex index: Int) -> Scene? {
        var cursor = 0
        for scene in scenes {
            if index < cursor + scene.assets.count { return scene }
            cursor += scene.assets.count
        }
        return scenes.last
    }

    /// The dissolve going INTO the shot at flat index `index`.
    ///
    /// Within a scene this is the scene's own `shotTransitionSeconds` (0 for a
    /// cut); across a scene boundary it is `sceneTransitionSeconds`, mirroring
    /// the server's `xfade` — unless the scene's chosen transition into it is a
    /// cut, which the studio offers and which is honoured rather than dissolved
    /// over. The first shot of the timeline has no dissolve.
    func dissolve(beforeFlatIndex index: Int) -> Double {
        guard index > 0 else { return 0 }
        var cursor = 0
        for scene in scenes {
            for i in 0..<scene.assets.count {
                if cursor == index {
                    if i == 0 { return scene.transitionIn == .cut ? 0 : sceneTransitionSeconds }
                    return scene.transitionIn == .cut ? 0 : scene.shotTransitionSeconds
                }
                cursor += 1
            }
        }
        return 0
    }
}

/// One error type for the whole render path, so a failure that reaches the web
/// layer always carries a sentence a tester can act on rather than an NSError
/// code they have to look up.
enum RenderError: LocalizedError {
    case manifest(String)
    case missingInput(String)
    case export(String)
    case audio(String)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .manifest(let message): return message
        case .missingInput(let message): return "This render needs \(message), which is not available"
        case .export(let message): return message
        case .audio(let message): return message
        case .cancelled: return "Render cancelled"
        }
    }
}
