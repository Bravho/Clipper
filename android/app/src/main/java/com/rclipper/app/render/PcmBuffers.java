package com.rclipper.app.render;

/**
 * The memory-bounded parts of the phone's audio mix, kept free of Android
 * classes so they can be compiled and tested on their own.
 *
 * WHY THIS EXISTS (2026-10-11). The app closed itself during Render step 2,
 * "Voice and music". The mixer decoded the WHOLE background track — about
 * three minutes — into a growable float array, copied it, folded it to stereo
 * and resampled it, keeping several full copies alive at once: roughly
 * 60–70 MB each, 200 MB+ at the peak, inside an app whose Java heap (with the
 * WebView alongside) is usually 256 MB. That is an OutOfMemoryError, which is
 * an Error, not an Exception, so the render thread's catch blocks let it
 * through and Android killed the app. Only ~45 s of that track is ever heard.
 *
 * Now:
 *  - a track is decoded only as far as the video needs (`ShortCollector` has
 *    a hard cap and the decoder stops at it);
 *  - samples are held as 16-bit shorts, half the size of floats;
 *  - nothing is copied whole more than once;
 *  - the mix is produced in small chunks straight into the encoder
 *    (`MixSource`), so there is no full-length mixed array at all.
 * For a 45 s video that is about 8 MB per track instead of 200 MB+.
 */
public final class PcmBuffers {

    public static final int CHANNELS = 2;

    private PcmBuffers() { }

    /**
     * Interleaved 16-bit samples as they come out of a decoder, growing as
     * needed but never past `capSamples`.
     */
    public static final class ShortCollector {
        private short[] data;
        private int size;
        private int capSamples;

        public ShortCollector(int initialCapacity, int capSamples) {
            this.capSamples = Math.max(0, capSamples);
            this.data = new short[Math.max(1, Math.min(initialCapacity, Math.max(1, this.capSamples)))];
        }

        /** Change the cap (the decoder may report its real rate/channels late). */
        public void setCap(int capSamples) {
            this.capSamples = Math.max(0, capSamples);
        }

        public boolean full() {
            return size >= capSamples;
        }

        public int size() {
            return size;
        }

        public short[] data() {
            return data;
        }

        /** Append up to `count` samples from `source`; returns how many were kept. */
        public int add(short[] source, int offset, int count) {
            int room = capSamples - size;
            int take = Math.max(0, Math.min(count, room));
            if (take == 0) return 0;
            ensure(size + take);
            System.arraycopy(source, offset, data, size, take);
            size += take;
            return take;
        }

        private void ensure(int needed) {
            if (needed <= data.length) return;
            long grown = Math.max((long) needed, (long) data.length * 2L);
            int next = (int) Math.min(grown, (long) Math.max(needed, capSamples));
            short[] bigger = new short[next];
            System.arraycopy(data, 0, bigger, 0, size);
            data = bigger;
        }
    }

    /** How many source samples (all channels) cover `targetFrames` at the target rate. */
    public static int sourceSamplesFor(int targetFrames, int sourceRate, int targetRate, int channels) {
        if (sourceRate <= 0 || targetRate <= 0) return Math.max(0, targetFrames) * Math.max(1, channels);
        double frames = Math.ceil(targetFrames * (double) sourceRate / targetRate) + 2;
        double samples = frames * Math.max(1, channels);
        return (int) Math.min(Integer.MAX_VALUE - 16, samples);
    }

    /**
     * Fold interleaved samples to stereo and resample them to `targetRate`
     * (linear interpolation, as before), keeping at most `maxFrames` frames.
     */
    public static short[] toStereo(
        short[] samples, int length, int channels, int sourceRate, int targetRate, int maxFrames
    ) {
        if (channels <= 0) channels = 1;
        int frames = length / channels;
        if (frames <= 0 || maxFrames <= 0) return new short[0];

        boolean sameRate = sourceRate == targetRate || sourceRate <= 0 || targetRate <= 0;
        double ratio = sameRate ? 1d : (double) targetRate / sourceRate;
        int outFrames = sameRate ? frames : (int) Math.floor(frames * ratio);
        outFrames = Math.min(outFrames, maxFrames);
        short[] out = new short[outFrames * CHANNELS];

        for (int frame = 0; frame < outFrames; frame++) {
            double position = sameRate ? frame : frame / ratio;
            int index = Math.min((int) Math.floor(position), frames - 1);
            double fraction = position - index;
            int next = Math.min(index + 1, frames - 1);
            for (int channel = 0; channel < CHANNELS; channel++) {
                int sourceChannel = channels > 1 ? channel : 0;
                int a = samples[index * channels + sourceChannel];
                int b = samples[next * channels + sourceChannel];
                double value = a + (b - a) * fraction;
                out[frame * CHANNELS + channel] = (short) Math.round(value);
            }
        }
        return out;
    }

    /** The settings `MixSource` needs, mirroring `deviceRenderAudio.ts`. */
    public static final class MixSettings {
        public float voiceGain = 1f;
        public int leadInFrames;
        public float musicBedVolume;
        public float duckThreshold;
        public float duckRatio;
        public float attackCoefficient;
        public float releaseCoefficient;
        public float limit = 0.95f;
    }

    /**
     * The mix, produced on demand in chunks — the voice delayed by the lead-in,
     * the music looped under it and ducked by the voice, summed and limited —
     * exactly the per-sample maths the mixer always did, without ever holding
     * the whole mixed clip.
     */
    public static final class MixSource {
        private final short[] voice;
        private final short[] music;
        private final int voiceFrames;
        private final int musicFrames;
        private final int totalFrames;
        private final MixSettings settings;
        private int frame;
        private float envelope;

        public MixSource(short[] voice, short[] music, int totalFrames, MixSettings settings) {
            this.voice = voice;
            this.music = music != null && music.length >= CHANNELS ? music : null;
            this.voiceFrames = voice.length / CHANNELS;
            this.musicFrames = this.music != null ? this.music.length / CHANNELS : 0;
            this.totalFrames = totalFrames;
            this.settings = settings;
        }

        public int position() {
            return frame;
        }

        public boolean done() {
            return frame >= totalFrames;
        }

        /**
         * Write up to `maxSamples` interleaved 16-bit samples into `out`;
         * returns how many were written (0 when the mix is finished).
         */
        public int fill(short[] out, int maxSamples) {
            int frames = Math.min(maxSamples / CHANNELS, totalFrames - frame);
            if (frames <= 0) return 0;
            for (int i = 0; i < frames; i++, frame++) {
                float voiceL = 0f;
                float voiceR = 0f;
                int voiceIndex = frame - settings.leadInFrames;
                if (voiceIndex >= 0 && voiceIndex < voiceFrames) {
                    voiceL = voice[voiceIndex * CHANNELS] / 32768f * settings.voiceGain;
                    voiceR = voice[voiceIndex * CHANNELS + 1] / 32768f * settings.voiceGain;
                }

                // The sidechain key is the delayed, normalised voice — so ducking
                // only engages once narration starts, leaving the music-only
                // intro at the full bed level.
                float key = Math.max(Math.abs(voiceL), Math.abs(voiceR));
                float coefficient = key > envelope ? settings.attackCoefficient : settings.releaseCoefficient;
                envelope = key + coefficient * (envelope - key);

                float left = voiceL;
                float right = voiceR;
                if (music != null) {
                    float duck = duckGain(envelope, settings.duckThreshold, settings.duckRatio);
                    int source = frame % musicFrames;
                    left += music[source * CHANNELS] / 32768f * settings.musicBedVolume * duck;
                    right += music[source * CHANNELS + 1] / 32768f * settings.musicBedVolume * duck;
                }

                // `amix=normalize=0` then `alimiter`: sum without rescaling,
                // then clip the peaks that produces.
                out[i * CHANNELS] = toShort(clamp(left, settings.limit));
                out[i * CHANNELS + 1] = toShort(clamp(right, settings.limit));
            }
            return frames * CHANNELS;
        }
    }

    static float clamp(float sample, float limit) {
        return Math.max(-limit, Math.min(limit, sample));
    }

    static short toShort(float sample) {
        float bounded = Math.max(-1f, Math.min(1f, sample));
        return (short) Math.round(bounded * 32767f);
    }

    /** Mirrors `duckGain` — `sidechaincompress=threshold=T:ratio=R` in dB. */
    public static float duckGain(float envelope, float threshold, float ratio) {
        if (!(envelope > threshold) || !(ratio > 1)) return 1f;
        double overDb = linearToDb(envelope) - linearToDb(threshold);
        double reductionDb = overDb - overDb / ratio;
        return dbToLinear(-reductionDb);
    }

    public static float dbToLinear(double db) {
        return (float) Math.pow(10, db / 20);
    }

    public static double linearToDb(double linear) {
        return 20 * Math.log10(Math.max(linear, 1e-9));
    }

    public static float envelopeCoefficient(float timeMs, int sampleRate) {
        if (!(timeMs > 0) || sampleRate <= 0) return 0f;
        return (float) Math.exp(-1 / ((timeMs / 1000d) * sampleRate));
    }
}
