package com.rclipper.app.render;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;

/**
 * The server's audio mix, done on the phone.
 *
 * WHY THIS IS HAND-WRITTEN DSP. The merged master's sound is one FFmpeg
 * filtergraph: normalise the voice to -16 LUFS with a -1.5 dBTP ceiling, delay
 * it by the 0.6 s music lead-in, pad it to the full clip, split it so one branch
 * keys a sidechain compressor, loop the music at 0.3 underneath, duck it with
 * threshold 0.03 / ratio 2.5 / attack 20 ms / release 300 ms, mix without
 * renormalising and limit at 0.95. Media3 has a gain processor and nothing else
 * on that list — no loudness normaliser, and no sidechain compressor at all.
 * Mixing with `GainProcessor` alone is exactly what the draft renderer did, and
 * it produced a bed that either buried the narration or vanished under it.
 *
 * So the mixer decodes both tracks to PCM, does the maths from
 * `src/lib/mobile/deviceRenderAudio.ts` sample by sample, and encodes one AAC
 * track. That track then becomes the composition's only audio sequence, which
 * also removes the "is the voice actually in the file" question: the mixer
 * verifies it before handing the file back.
 *
 * WHAT DIFFERS FROM FFMPEG, HONESTLY. `loudnorm` runs two passes and measures
 * BS.1770 integrated loudness; this runs one pass and measures RMS, clamped to
 * +/-18 dB of correction. For speech the two land within a decibel or so, which
 * is inside the range a listener would call "the same level" — but it is an
 * approximation, and it is why the comparison fixtures include a loudness check
 * rather than only a "can you hear it" check.
 */
public final class AudioMixer {

    private static final int CHANNELS = PcmBuffers.CHANNELS;
    private static final int ENCODE_BITRATE = 192_000;
    private static final long CODEC_TIMEOUT_US = 10_000;

    private final RenderManifest.AudioSpec spec;

    public AudioMixer(RenderManifest.AudioSpec spec) {
        this.spec = spec;
    }

    /** What the mix produced, so the caller can report and verify it. */
    public static final class Result {
        public final File file;
        public final double durationSeconds;
        public final double voicePeak;
        public final float voiceGain;

        Result(File file, double durationSeconds, double voicePeak, float voiceGain) {
            this.file = file;
            this.durationSeconds = durationSeconds;
            this.voicePeak = voicePeak;
            this.voiceGain = voiceGain;
        }
    }

    /**
     * Mix the approved voice and optional music into one AAC file covering
     * `totalSeconds`.
     *
     * MEMORY. Everything here is bounded by the video's length, not the
     * music's: each track is decoded only as far as the video needs, held as
     * 16-bit samples, and the mix is generated chunk by chunk straight into the
     * encoder (see {@link PcmBuffers} for why — the old full-track decode ran
     * the app out of memory and closed it during "Voice and music").
     *
     * @param voice  the approved ElevenLabs voice, already downloaded
     * @param music  the selected background track, or null
     * @param totalSeconds the whole clip length: max(picture, voice + lead-in)
     */
    public Result mix(File voice, File music, double totalSeconds, File output) throws IOException {
        if (voice == null || !voice.isFile()) {
            throw new IOException("The approved speaking voice is missing; a final export cannot be silent");
        }
        if (!(totalSeconds > 0)) throw new IOException("Invalid mix duration");

        int sampleRate = spec.sampleRate;
        int totalFrames = (int) Math.round(totalSeconds * sampleRate);
        if (totalFrames <= 0) throw new IOException("Invalid mix length");
        int leadInFrames = Math.max(0, (int) Math.round(spec.leadInSeconds * sampleRate));

        // The voice is only heard from the lead-in to the end of the clip.
        short[] voicePcm = decode(voice, sampleRate, Math.max(1, totalFrames - leadInFrames));
        if (voicePcm.length == 0) {
            throw new IOException("The speaking voice decoded to nothing");
        }

        // ── 1. Normalise the voice ──────────────────────────────────────────
        double sumSquares = 0;
        double peak = 0;
        int counted = 0;
        for (short raw : voicePcm) {
            float sample = raw / 32768f;
            float abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            // Silence at the head and tail of a TTS render would drag the RMS
            // down and make the normaliser over-boost, so only audible samples
            // count toward the measurement.
            if (abs > 0.0005f) {
                sumSquares += (double) sample * sample;
                counted++;
            }
        }
        double rms = counted > 0 ? Math.sqrt(sumSquares / counted) : 0;
        float voiceGain = voiceNormalizationGain(rms, peak);

        // ── 2. The music: only as much as the clip needs; looped if shorter ──
        short[] musicPcm = null;
        if (music != null && music.isFile() && spec.musicSelected) {
            short[] decoded = decode(music, sampleRate, totalFrames);
            if (decoded.length >= CHANNELS) musicPcm = decoded;
        }

        // ── 3. Duck, mix and encode, a chunk at a time ──────────────────────
        PcmBuffers.MixSettings settings = new PcmBuffers.MixSettings();
        settings.voiceGain = voiceGain;
        settings.leadInFrames = leadInFrames;
        settings.musicBedVolume = spec.musicBedVolume;
        settings.duckThreshold = spec.duckThreshold;
        settings.duckRatio = spec.duckRatio;
        settings.attackCoefficient = envelopeCoefficient(spec.duckAttackMs, sampleRate);
        settings.releaseCoefficient = envelopeCoefficient(spec.duckReleaseMs, sampleRate);
        settings.limit = spec.limit;

        encodeAac(new PcmBuffers.MixSource(voicePcm, musicPcm, totalFrames, settings), sampleRate, output);
        return new Result(output, totalSeconds, peak, voiceGain);
    }

    // ── DSP, mirroring deviceRenderAudio.ts ─────────────────────────────────

    private static float dbToLinear(double db) {
        return PcmBuffers.dbToLinear(db);
    }

    private static double linearToDb(double linear) {
        return PcmBuffers.linearToDb(linear);
    }

    static float envelopeCoefficient(float timeMs, int sampleRate) {
        return PcmBuffers.envelopeCoefficient(timeMs, sampleRate);
    }

    /** Mirrors `voiceNormalizationGain`. */
    float voiceNormalizationGain(double rms, double peak) {
        if (!(rms > 0)) return 1f;
        double wanted = spec.targetLufs - linearToDb(rms);
        double clamped = Math.min(spec.maxGainDb, Math.max(-spec.maxGainDb, wanted));
        float gain = dbToLinear(clamped);
        if (peak > 0) {
            float ceiling = dbToLinear(spec.truePeakDb);
            if (peak * gain > ceiling) gain = (float) (ceiling / peak);
        }
        return gain;
    }

    /** Mirrors `duckGain` — `sidechaincompress=threshold=T:ratio=R` in dB. */
    float duckGain(float envelope) {
        return PcmBuffers.duckGain(envelope, spec.duckThreshold, spec.duckRatio);
    }

    // ── Decode ──────────────────────────────────────────────────────────────

    /**
     * Decode an audio file to interleaved stereo 16-bit PCM at `targetRate`,
     * stopping once `maxFrames` frames (at the target rate) are covered.
     *
     * Channel and rate conversion are done here rather than by the decoder
     * because `MediaCodec` will happily hand back mono at 44.1 kHz and there is
     * no portable resampler in the platform API. Linear interpolation is enough
     * for a 44.1 -> 48 kHz hop on speech and music.
     */
    private short[] decode(File file, int targetRate, int maxFrames) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        try {
            extractor.setDataSource(file.getAbsolutePath());
            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    format = candidate;
                    break;
                }
            }
            if (track < 0 || format == null) {
                throw new IOException("No audio track in " + file.getName());
            }
            extractor.selectTrack(track);

            int sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int sourceChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);

            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            codec.configure(format, null, null, 0);
            codec.start();

            int cap = PcmBuffers.sourceSamplesFor(maxFrames, sourceRate, targetRate, sourceChannels);
            PcmBuffers.ShortCollector decoded =
                new PcmBuffers.ShortCollector(Math.min(cap, 1 << 18), cap);
            short[] chunk = new short[16 * 1024];
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int index = codec.dequeueInputBuffer(CODEC_TIMEOUT_US);
                    if (index >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(index);
                        int size = buffer == null ? -1 : extractor.readSampleData(buffer, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(index, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }

                int outIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US);
                if (outIndex >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(outIndex);
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        ShortBuffer shorts = buffer.order(ByteOrder.nativeOrder()).asShortBuffer();
                        while (shorts.hasRemaining() && !decoded.full()) {
                            int count = Math.min(chunk.length, shorts.remaining());
                            shorts.get(chunk, 0, count);
                            decoded.add(chunk, 0, count);
                        }
                    }
                    codec.releaseOutputBuffer(outIndex, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                    // Enough for the clip: the rest of the track is never heard.
                    if (decoded.full()) outputDone = true;
                } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat outFormat = codec.getOutputFormat();
                    sourceRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    sourceChannels = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    decoded.setCap(
                        PcmBuffers.sourceSamplesFor(maxFrames, sourceRate, targetRate, sourceChannels));
                }
            }

            return PcmBuffers.toStereo(
                decoded.data(), decoded.size(), sourceChannels, sourceRate, targetRate, maxFrames);
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (RuntimeException ignored) { }
                codec.release();
            }
            extractor.release();
        }
    }

    // ── Encode ──────────────────────────────────────────────────────────────

    private void encodeAac(PcmBuffers.MixSource source, int sampleRate, File output) throws IOException {
        MediaFormat format = MediaFormat.createAudioFormat(
            MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, CHANNELS);
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        format.setInteger(MediaFormat.KEY_BIT_RATE, ENCODE_BITRATE);
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024);

        MediaCodec codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        MediaMuxer muxer = null;
        short[] chunk = new short[32 * 1024];
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int muxerTrack = -1;
            boolean muxerStarted = false;
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int index = codec.dequeueInputBuffer(CODEC_TIMEOUT_US);
                    if (index >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(index);
                        if (buffer == null) throw new IOException("Encoder gave no input buffer");
                        buffer.clear();
                        long presentationTimeUs =
                            (long) (source.position() / (double) sampleRate * 1_000_000d);
                        int capacityShorts = Math.min(buffer.capacity() / 2, chunk.length);
                        // Whole frames only, so left and right never split.
                        capacityShorts -= capacityShorts % CHANNELS;
                        int count = source.fill(chunk, capacityShorts);
                        if (count <= 0) {
                            codec.queueInputBuffer(index, 0, 0, presentationTimeUs,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            ShortBuffer shorts = buffer.order(ByteOrder.nativeOrder()).asShortBuffer();
                            shorts.put(chunk, 0, count);
                            codec.queueInputBuffer(index, 0, count * 2, presentationTimeUs, 0);
                        }
                    }
                }

                int outIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US);
                if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    muxerTrack = muxer.addTrack(codec.getOutputFormat());
                    muxer.start();
                    muxerStarted = true;
                } else if (outIndex >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(outIndex);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
                    if (info.size > 0 && muxerStarted && buffer != null) {
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        muxer.writeSampleData(muxerTrack, buffer, info);
                    }
                    codec.releaseOutputBuffer(outIndex, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                }
            }
        } finally {
            try { codec.stop(); } catch (RuntimeException ignored) { }
            codec.release();
            if (muxer != null) {
                try { muxer.stop(); } catch (RuntimeException ignored) { }
                muxer.release();
            }
        }

        if (!output.isFile() || output.length() == 0) {
            throw new IOException("The audio mix produced no bytes");
        }
    }
}
