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

    private static final int CHANNELS = 2;
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

        float[] voicePcm = decodeToFloat(voice, sampleRate);
        if (voicePcm.length == 0) {
            throw new IOException("The speaking voice decoded to nothing");
        }

        // ── 1. Normalise the voice ──────────────────────────────────────────
        double sumSquares = 0;
        double peak = 0;
        int counted = 0;
        for (float sample : voicePcm) {
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
        for (int i = 0; i < voicePcm.length; i++) voicePcm[i] *= voiceGain;

        // ── 2. Lay the voice out on the timeline ────────────────────────────
        // Delayed by the lead-in and padded with silence to the full clip, so
        // the sidechain key runs the whole way and the bed recovers under the
        // ending instead of the mix stopping with the narration.
        int leadInFrames = (int) Math.round(spec.leadInSeconds * sampleRate);
        float[] voiceTrack = new float[totalFrames * CHANNELS];
        int voiceFrames = voicePcm.length / CHANNELS;
        for (int frame = 0; frame < voiceFrames; frame++) {
            int target = frame + leadInFrames;
            if (target < 0 || target >= totalFrames) continue;
            voiceTrack[target * CHANNELS] = voicePcm[frame * CHANNELS];
            voiceTrack[target * CHANNELS + 1] = voicePcm[frame * CHANNELS + 1];
        }

        // ── 3. Loop the music under it ──────────────────────────────────────
        float[] musicTrack = null;
        if (music != null && music.isFile() && spec.musicSelected) {
            float[] musicPcm = decodeToFloat(music, sampleRate);
            if (musicPcm.length >= CHANNELS) {
                musicTrack = new float[totalFrames * CHANNELS];
                int musicFrames = musicPcm.length / CHANNELS;
                for (int frame = 0; frame < totalFrames; frame++) {
                    int source = frame % musicFrames;
                    musicTrack[frame * CHANNELS] = musicPcm[source * CHANNELS] * spec.musicBedVolume;
                    musicTrack[frame * CHANNELS + 1] = musicPcm[source * CHANNELS + 1] * spec.musicBedVolume;
                }
            }
        }

        // ── 4. Duck and mix ─────────────────────────────────────────────────
        float[] mixed = new float[totalFrames * CHANNELS];
        float attackCoefficient = envelopeCoefficient(spec.duckAttackMs, sampleRate);
        float releaseCoefficient = envelopeCoefficient(spec.duckReleaseMs, sampleRate);
        float envelope = 0f;

        for (int frame = 0; frame < totalFrames; frame++) {
            float voiceL = voiceTrack[frame * CHANNELS];
            float voiceR = voiceTrack[frame * CHANNELS + 1];

            // The sidechain key is the delayed, normalised voice — so ducking
            // only engages once narration actually starts, leaving the
            // music-only intro at the full bed level.
            float key = Math.max(Math.abs(voiceL), Math.abs(voiceR));
            float coefficient = key > envelope ? attackCoefficient : releaseCoefficient;
            envelope = key + coefficient * (envelope - key);

            float duck = musicTrack != null ? duckGain(envelope) : 1f;

            float left = voiceL;
            float right = voiceR;
            if (musicTrack != null) {
                left += musicTrack[frame * CHANNELS] * duck;
                right += musicTrack[frame * CHANNELS + 1] * duck;
            }

            // `amix=normalize=0` then `alimiter=limit=0.95`: sum without
            // rescaling, then clip the peaks that produces.
            mixed[frame * CHANNELS] = limit(left);
            mixed[frame * CHANNELS + 1] = limit(right);
        }

        encodeAac(mixed, sampleRate, output);
        return new Result(output, totalSeconds, peak, voiceGain);
    }

    // ── DSP, mirroring deviceRenderAudio.ts ─────────────────────────────────

    private float limit(float sample) {
        return Math.max(-spec.limit, Math.min(spec.limit, sample));
    }

    private static float dbToLinear(double db) {
        return (float) Math.pow(10, db / 20);
    }

    private static double linearToDb(double linear) {
        return 20 * Math.log10(Math.max(linear, 1e-9));
    }

    static float envelopeCoefficient(float timeMs, int sampleRate) {
        if (!(timeMs > 0) || sampleRate <= 0) return 0f;
        return (float) Math.exp(-1 / ((timeMs / 1000d) * sampleRate));
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
        if (!(envelope > spec.duckThreshold) || !(spec.duckRatio > 1)) return 1f;
        double overDb = linearToDb(envelope) - linearToDb(spec.duckThreshold);
        double reductionDb = overDb - overDb / spec.duckRatio;
        return dbToLinear(-reductionDb);
    }

    // ── Decode ──────────────────────────────────────────────────────────────

    /**
     * Decode any audio file to interleaved stereo float PCM at `sampleRate`.
     *
     * Channel and rate conversion are done here rather than by the decoder
     * because `MediaCodec` will happily hand back mono at 44.1 kHz and there is
     * no portable resampler in the platform API. Linear interpolation is enough
     * for a 44.1 -> 48 kHz hop on speech and music; it is not enough for
     * anything that would be audible as aliasing at these ratios.
     */
    private float[] decodeToFloat(File file, int targetRate) throws IOException {
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

            GrowableFloatArray decoded = new GrowableFloatArray();
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
                        while (shorts.hasRemaining()) {
                            decoded.add(shorts.get() / 32768f);
                        }
                    }
                    codec.releaseOutputBuffer(outIndex, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat outFormat = codec.getOutputFormat();
                    sourceRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    sourceChannels = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                }
            }

            return conform(decoded.toArray(), sourceChannels, sourceRate, targetRate);
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (RuntimeException ignored) { }
                codec.release();
            }
            extractor.release();
        }
    }

    /** Interleave to stereo and resample to the mix rate. */
    private static float[] conform(float[] samples, int channels, int sourceRate, int targetRate) {
        if (channels <= 0) channels = 1;
        int frames = samples.length / channels;
        if (frames == 0) return new float[0];

        // To stereo first: mono is duplicated, anything wider is folded down by
        // taking its first two channels (surround material is not something the
        // pipeline produces, and averaging N channels would change the level).
        float[] stereo = new float[frames * CHANNELS];
        for (int frame = 0; frame < frames; frame++) {
            float left = samples[frame * channels];
            float right = channels > 1 ? samples[frame * channels + 1] : left;
            stereo[frame * CHANNELS] = left;
            stereo[frame * CHANNELS + 1] = right;
        }
        if (sourceRate == targetRate || sourceRate <= 0) return stereo;

        double ratio = (double) targetRate / sourceRate;
        int outFrames = (int) Math.floor(frames * ratio);
        float[] resampled = new float[outFrames * CHANNELS];
        for (int frame = 0; frame < outFrames; frame++) {
            double sourcePosition = frame / ratio;
            int index = (int) Math.floor(sourcePosition);
            double fraction = sourcePosition - index;
            int next = Math.min(index + 1, frames - 1);
            for (int channel = 0; channel < CHANNELS; channel++) {
                float a = stereo[index * CHANNELS + channel];
                float b = stereo[next * CHANNELS + channel];
                resampled[frame * CHANNELS + channel] = (float) (a + (b - a) * fraction);
            }
        }
        return resampled;
    }

    // ── Encode ──────────────────────────────────────────────────────────────

    private void encodeAac(float[] pcm, int sampleRate, File output) throws IOException {
        MediaFormat format = MediaFormat.createAudioFormat(
            MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, CHANNELS);
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        format.setInteger(MediaFormat.KEY_BIT_RATE, ENCODE_BITRATE);
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024);

        MediaCodec codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        MediaMuxer muxer = null;
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int muxerTrack = -1;
            boolean muxerStarted = false;
            int sampleIndex = 0;
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int index = codec.dequeueInputBuffer(CODEC_TIMEOUT_US);
                    if (index >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(index);
                        if (buffer == null) throw new IOException("Encoder gave no input buffer");
                        buffer.clear();
                        int capacityShorts = buffer.capacity() / 2;
                        int count = Math.min(capacityShorts, pcm.length - sampleIndex);
                        ShortBuffer shorts = buffer.order(ByteOrder.nativeOrder()).asShortBuffer();
                        for (int i = 0; i < count; i++) {
                            float sample = Math.max(-1f, Math.min(1f, pcm[sampleIndex + i]));
                            shorts.put((short) Math.round(sample * 32767f));
                        }
                        long presentationTimeUs =
                            (long) (sampleIndex / (double) CHANNELS / sampleRate * 1_000_000d);
                        if (count <= 0) {
                            codec.queueInputBuffer(index, 0, 0, presentationTimeUs,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(index, 0, count * 2, presentationTimeUs, 0);
                            sampleIndex += count;
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

    /** A float[] that grows, because decoded length is not known up front. */
    private static final class GrowableFloatArray {
        private float[] data = new float[1 << 16];
        private int size;

        void add(float value) {
            if (size == data.length) {
                float[] grown = new float[data.length * 2];
                System.arraycopy(data, 0, grown, 0, size);
                data = grown;
            }
            data[size++] = value;
        }

        float[] toArray() {
            float[] result = new float[size];
            System.arraycopy(data, 0, result, 0, size);
            return result;
        }
    }
}
