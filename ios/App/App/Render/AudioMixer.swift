import AVFoundation
import Foundation

/// The server's audio mix, done on the phone.
///
/// WHY THIS IS HAND-WRITTEN DSP. The merged master's sound is one FFmpeg
/// filtergraph: normalise the voice to -16 LUFS with a -1.5 dBTP ceiling, delay
/// it by the 0.6 s music lead-in, pad it to the full clip, split it so one
/// branch keys a sidechain compressor, loop the music at 0.3 underneath, duck it
/// with threshold 0.03 / ratio 2.5 / attack 20 ms / release 300 ms, mix without
/// renormalising and limit at 0.95. `AVAudioMix` can set a volume and ramp it on
/// a schedule; it cannot normalise loudness and it has no sidechain at all.
/// Setting the bed to a fixed 0.3 is exactly what the draft renderer did, and it
/// produced a bed that either buried the narration or vanished under it.
///
/// So the mixer reads both tracks into PCM, does the maths from
/// `src/lib/mobile/deviceRenderAudio.ts` sample by sample, and writes one AAC
/// file. It is the exact counterpart of Android's `AudioMixer.java`, down to the
/// envelope follower, so the two phones and the Mac produce the same mix.
///
/// WHAT DIFFERS FROM FFMPEG, HONESTLY. `loudnorm` runs two passes and measures
/// BS.1770 integrated loudness; this runs one pass and measures RMS, clamped to
/// +/-18 dB of correction. For speech the two land within about a decibel, which
/// is inside the range a listener would call "the same level" — but it is an
/// approximation, and it is why the comparison fixtures include a loudness check
/// rather than only a "can you hear it" check.
final class AudioMixer {

    private let spec: RenderManifest.AudioSpec
    private let channels: AVAudioChannelCount = 2

    init(spec: RenderManifest.AudioSpec) {
        self.spec = spec
    }

    struct Result {
        let url: URL
        let durationSeconds: Double
        let voiceGain: Float
    }

    /// Mix the approved voice and optional music into one AAC file covering
    /// `totalSeconds` — the whole clip: max(picture, voice + lead-in).
    func mix(voice: URL, music: URL?, totalSeconds: Double, output: URL) throws -> Result {
        guard totalSeconds > 0 else { throw RenderError.audio("Invalid mix duration") }

        let sampleRate = Double(spec.sampleRate)
        let totalFrames = Int((totalSeconds * sampleRate).rounded())
        guard totalFrames > 0 else { throw RenderError.audio("Invalid mix length") }

        var voicePcm = try readInterleaved(url: voice, sampleRate: sampleRate)
        guard !voicePcm.isEmpty else {
            throw RenderError.audio("The speaking voice decoded to nothing")
        }

        // ── 1. Normalise the voice ──────────────────────────────────────────
        var sumSquares: Double = 0
        var peak: Double = 0
        var counted = 0
        for sample in voicePcm {
            let magnitude = Double(abs(sample))
            if magnitude > peak { peak = magnitude }
            // Silence at the head and tail of a TTS render would drag the RMS
            // down and make the normaliser over-boost, so only audible samples
            // count toward the measurement.
            if magnitude > 0.0005 {
                sumSquares += magnitude * magnitude
                counted += 1
            }
        }
        let rms = counted > 0 ? (sumSquares / Double(counted)).squareRoot() : 0
        let voiceGain = normalizationGain(rms: rms, peak: peak)
        for index in voicePcm.indices { voicePcm[index] *= voiceGain }

        // ── 2. Lay the voice out on the timeline ────────────────────────────
        // Delayed by the lead-in and padded with silence to the full clip, so
        // the sidechain key runs the whole way and the bed recovers under the
        // ending instead of the mix stopping with the narration.
        let leadInFrames = Int((spec.voiceLeadInSeconds * sampleRate).rounded())
        var voiceTrack = [Float](repeating: 0, count: totalFrames * 2)
        let voiceFrames = voicePcm.count / 2
        for frame in 0..<voiceFrames {
            let target = frame + leadInFrames
            guard target >= 0, target < totalFrames else { continue }
            voiceTrack[target * 2] = voicePcm[frame * 2]
            voiceTrack[target * 2 + 1] = voicePcm[frame * 2 + 1]
        }

        // ── 3. Loop the music under it ──────────────────────────────────────
        var musicTrack: [Float]?
        if spec.musicSelected, let music {
            let musicPcm = try readInterleaved(url: music, sampleRate: sampleRate)
            if musicPcm.count >= 2 {
                let musicFrames = musicPcm.count / 2
                let bed = Float(spec.musicBedVolume)
                var track = [Float](repeating: 0, count: totalFrames * 2)
                for frame in 0..<totalFrames {
                    let source = frame % musicFrames
                    track[frame * 2] = musicPcm[source * 2] * bed
                    track[frame * 2 + 1] = musicPcm[source * 2 + 1] * bed
                }
                musicTrack = track
            }
        }

        // ── 4. Duck and mix ─────────────────────────────────────────────────
        var mixed = [Float](repeating: 0, count: totalFrames * 2)
        let attack = envelopeCoefficient(ms: spec.musicDuckAttackMs, sampleRate: sampleRate)
        let release = envelopeCoefficient(ms: spec.musicDuckReleaseMs, sampleRate: sampleRate)
        let limit = Float(spec.mixLimit)
        var envelope: Float = 0

        for frame in 0..<totalFrames {
            let voiceL = voiceTrack[frame * 2]
            let voiceR = voiceTrack[frame * 2 + 1]

            // The sidechain key is the delayed, normalised voice — so ducking
            // only engages once narration actually starts, leaving the
            // music-only intro at the full bed level.
            let key = max(abs(voiceL), abs(voiceR))
            let coefficient = key > envelope ? attack : release
            envelope = key + coefficient * (envelope - key)

            var left = voiceL
            var right = voiceR
            if let musicTrack {
                let duck = duckGain(envelope: envelope)
                left += musicTrack[frame * 2] * duck
                right += musicTrack[frame * 2 + 1] * duck
            }

            // `amix=normalize=0` then `alimiter=limit=0.95`: sum without
            // rescaling, then clip the peaks that produces.
            mixed[frame * 2] = min(limit, max(-limit, left))
            mixed[frame * 2 + 1] = min(limit, max(-limit, right))
        }

        try writeAac(samples: mixed, sampleRate: sampleRate, to: output)
        return Result(url: output, durationSeconds: totalSeconds, voiceGain: voiceGain)
    }

    // ── DSP, mirroring deviceRenderAudio.ts ─────────────────────────────────

    private func linearToDb(_ linear: Double) -> Double {
        20 * log10(Swift.max(linear, 1e-9))
    }

    private func dbToLinear(_ db: Double) -> Float {
        Float(pow(10, db / 20))
    }

    private func envelopeCoefficient(ms: Double, sampleRate: Double) -> Float {
        guard ms > 0, sampleRate > 0 else { return 0 }
        return Float(exp(-1 / ((ms / 1000) * sampleRate)))
    }

    /// Mirrors `voiceNormalizationGain`.
    func normalizationGain(rms: Double, peak: Double) -> Float {
        guard rms > 0 else { return 1 }
        let wanted = spec.voiceTargetLufs - linearToDb(rms)
        let clamped = Swift.min(spec.voiceMaxGainDb, Swift.max(-spec.voiceMaxGainDb, wanted))
        var gain = dbToLinear(clamped)
        if peak > 0 {
            let ceiling = dbToLinear(spec.voiceTruePeakDb)
            if Float(peak) * gain > ceiling { gain = ceiling / Float(peak) }
        }
        return gain
    }

    /// Mirrors `duckGain` — `sidechaincompress=threshold=T:ratio=R` in dB.
    func duckGain(envelope: Float) -> Float {
        guard Double(envelope) > spec.musicDuckThreshold, spec.musicDuckRatio > 1 else { return 1 }
        let overDb = linearToDb(Double(envelope)) - linearToDb(spec.musicDuckThreshold)
        let reductionDb = overDb - overDb / spec.musicDuckRatio
        return dbToLinear(-reductionDb)
    }

    // ── Decode ──────────────────────────────────────────────────────────────

    /// Read any audio file as interleaved stereo Float32 at `sampleRate`.
    ///
    /// `AVAudioFile` converts on read when its processing format asks for a
    /// different layout, which is how the channel fold and the resample happen
    /// without a hand-written resampler — the one piece of this that Apple's
    /// frameworks genuinely do for us.
    private func readInterleaved(url: URL, sampleRate: Double) throws -> [Float] {
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forReading: url)
        } catch {
            throw RenderError.audio("Could not open \(url.lastPathComponent): \(error.localizedDescription)")
        }

        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: channels,
            interleaved: false
        ) else {
            throw RenderError.audio("Could not create the mix format")
        }

        guard let converter = AVAudioConverter(from: file.processingFormat, to: targetFormat) else {
            throw RenderError.audio("Could not convert \(url.lastPathComponent) to the mix format")
        }

        let sourceFrames = AVAudioFrameCount(file.length)
        guard sourceFrames > 0 else { return [] }

        let ratio = sampleRate / file.processingFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(sourceFrames) * ratio).rounded(.up) + 4096)
        guard let inputBuffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat, frameCapacity: sourceFrames),
              let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity)
        else {
            throw RenderError.audio("Could not allocate audio buffers")
        }

        try file.read(into: inputBuffer)

        var supplied = false
        var conversionError: NSError?
        converter.convert(to: outputBuffer, error: &conversionError) { _, status in
            if supplied {
                status.pointee = .endOfStream
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return inputBuffer
        }
        if let conversionError {
            throw RenderError.audio(
                "Could not decode \(url.lastPathComponent): \(conversionError.localizedDescription)")
        }

        guard let channelData = outputBuffer.floatChannelData else { return [] }
        let frames = Int(outputBuffer.frameLength)
        var interleaved = [Float](repeating: 0, count: frames * 2)
        let left = channelData[0]
        let right = outputBuffer.format.channelCount > 1 ? channelData[1] : channelData[0]
        for frame in 0..<frames {
            interleaved[frame * 2] = left[frame]
            interleaved[frame * 2 + 1] = right[frame]
        }
        return interleaved
    }

    // ── Encode ──────────────────────────────────────────────────────────────

    private func writeAac(samples: [Float], sampleRate: Double, to url: URL) throws {
        try? FileManager.default.removeItem(at: url)

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: Int(channels),
            AVEncoderBitRateKey: 192_000,
        ]

        let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else {
            throw RenderError.audio("This device cannot encode the mixed audio")
        }
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        guard let sourceFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: channels,
            interleaved: true
        ) else {
            throw RenderError.audio("Could not create the encode format")
        }

        // Feed the encoder in chunks rather than one enormous buffer: a 60 s
        // stereo float mix is about 23 MB, and handing that to the writer in one
        // piece is a spike an older iPhone does not need to take.
        let chunkFrames = 16_384
        let totalFrames = samples.count / 2
        var frameIndex = 0
        let queue = DispatchQueue(label: "com.rclipper.audiomix")
        let finished = DispatchSemaphore(value: 0)
        var writeError: Error?

        input.requestMediaDataWhenReady(on: queue) {
            while input.isReadyForMoreMediaData {
                if frameIndex >= totalFrames {
                    input.markAsFinished()
                    finished.signal()
                    return
                }
                let frames = Swift.min(chunkFrames, totalFrames - frameIndex)
                do {
                    let buffer = try Self.makeSampleBuffer(
                        samples: samples,
                        frameOffset: frameIndex,
                        frameCount: frames,
                        sampleRate: sampleRate,
                        format: sourceFormat
                    )
                    if !input.append(buffer) {
                        writeError = RenderError.audio("The audio encoder rejected a buffer")
                        input.markAsFinished()
                        finished.signal()
                        return
                    }
                } catch {
                    writeError = error
                    input.markAsFinished()
                    finished.signal()
                    return
                }
                frameIndex += frames
            }
        }

        finished.wait()
        if let writeError { throw writeError }

        let completed = DispatchSemaphore(value: 0)
        writer.finishWriting { completed.signal() }
        completed.wait()

        if writer.status != .completed {
            throw RenderError.audio(
                "The audio mix failed to write: \(writer.error?.localizedDescription ?? "unknown")")
        }
    }

    private static func makeSampleBuffer(
        samples: [Float],
        frameOffset: Int,
        frameCount: Int,
        sampleRate: Double,
        format: AVAudioFormat
    ) throws -> CMSampleBuffer {
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount)
        ) else {
            throw RenderError.audio("Could not allocate an encode buffer")
        }
        buffer.frameLength = AVAudioFrameCount(frameCount)

        guard let destination = buffer.floatChannelData?[0] else {
            throw RenderError.audio("Could not access the encode buffer")
        }
        samples.withUnsafeBufferPointer { source in
            guard let base = source.baseAddress else { return }
            destination.update(from: base + frameOffset * 2, count: frameCount * 2)
        }

        var sampleBuffer: CMSampleBuffer?
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: CMTimeScale(sampleRate)),
            presentationTimeStamp: CMTime(
                value: CMTimeValue(frameOffset), timescale: CMTimeScale(sampleRate)),
            decodeTimeStamp: .invalid
        )

        var formatDescription = buffer.format.formatDescription
        let status = CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: formatDescription,
            sampleCount: CMItemCount(frameCount),
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 0,
            sampleSizeArray: nil,
            sampleBufferOut: &sampleBuffer
        )
        guard status == noErr, let sampleBuffer else {
            throw RenderError.audio("Could not create an audio sample buffer (\(status))")
        }

        let setStatus = CMSampleBufferSetDataBufferFromAudioBufferList(
            sampleBuffer,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: buffer.mutableAudioBufferList
        )
        guard setStatus == noErr else {
            throw RenderError.audio("Could not attach audio data (\(setStatus))")
        }
        _ = formatDescription
        return sampleBuffer
    }
}
