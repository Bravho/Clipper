import {
  DEVICE_MUSIC_BED_VOLUME,
  DEVICE_MUSIC_DUCK_RATIO,
  DEVICE_MUSIC_DUCK_THRESHOLD,
  DEVICE_MUSIC_LEAD_IN_SECONDS,
  DEVICE_VOICE_TARGET_LUFS,
  DEVICE_VOICE_TRUE_PEAK_DB,
  deviceAudioMixSpec,
  dbToLinear,
  duckGain,
  envelopeCoefficient,
  linearToDb,
  mixedTrackDurationSeconds,
  nextEnvelope,
  voiceNormalizationGain,
} from "@/lib/mobile/deviceRenderAudio";
import {
  MUSIC_BED_VOLUME,
  MUSIC_DUCK_RATIO,
  MUSIC_LEAD_IN_SECONDS,
} from "@/lib/ai/ffmpegService";

/**
 * The phone mixes its own audio because neither Media3 nor AVFoundation has a
 * sidechain compressor or a loudness normaliser. That makes this file the only
 * place the phone's mix and the server's mix are checked against each other, so
 * it tests two things:
 *
 *   1. The constants have not drifted from `ffmpegService`.
 *   2. The maths does what the filtergraph does, at the points where being
 *      wrong is audible.
 */
describe("device audio mix", () => {
  it("uses the same constants as the server filtergraph", () => {
    // A phone bed at a different level, or a lead-in of a different length,
    // makes every caption land in the wrong place and the mix sound unlike the
    // approved master. Catching the drift here beats catching it by ear.
    expect(DEVICE_MUSIC_LEAD_IN_SECONDS).toBe(MUSIC_LEAD_IN_SECONDS);
    expect(DEVICE_MUSIC_BED_VOLUME).toBe(MUSIC_BED_VOLUME);
  });

  it("ducks the bed less than the server does (26 Sep 2026)", () => {
    // Phone renders lost the music under the voice; see DEVICE_MUSIC_DUCK_RATIO.
    expect(DEVICE_MUSIC_DUCK_RATIO).toBe(1.6);
    expect(DEVICE_MUSIC_DUCK_RATIO).toBeLessThan(MUSIC_DUCK_RATIO);
    // Speech at -16 dBFS RMS: about 4 dB of ducking, not 8.
    const reduction = -linearToDb(duckGain(0.158));
    expect(reduction).toBeGreaterThan(3);
    expect(reduction).toBeLessThan(6);
  });

  it("drops the lead-in when no music was selected", () => {
    // `composeSingleRatio` sets `leadIn = hasMusic ? 0.6 : 0`; a phone that kept
    // the lead-in without music would open on 0.6 s of silence.
    expect(deviceAudioMixSpec(true).leadInSeconds).toBe(DEVICE_MUSIC_LEAD_IN_SECONDS);
    expect(deviceAudioMixSpec(false).leadInSeconds).toBe(0);
  });

  describe("voice normalisation", () => {
    it("lifts a quiet voice toward the target", () => {
      const quiet = dbToLinear(DEVICE_VOICE_TARGET_LUFS - 10);
      const gain = voiceNormalizationGain(quiet, quiet * 4);
      expect(linearToDb(gain)).toBeGreaterThan(5);
      expect(linearToDb(quiet * gain)).toBeCloseTo(DEVICE_VOICE_TARGET_LUFS, 1);
    });

    it("pulls a loud voice down", () => {
      const loud = dbToLinear(DEVICE_VOICE_TARGET_LUFS + 8);
      const gain = voiceNormalizationGain(loud, loud);
      expect(gain).toBeLessThan(1);
    });

    it("never pushes the true peak above the ceiling", () => {
      // A recording that is quiet on average but has one loud peak is the case
      // that clips: boosting to hit -16 LUFS would push that peak over 0 dBFS.
      const rms = dbToLinear(DEVICE_VOICE_TARGET_LUFS - 12);
      const peak = 0.95;
      const gain = voiceNormalizationGain(rms, peak);
      expect(linearToDb(peak * gain)).toBeLessThanOrEqual(DEVICE_VOICE_TRUE_PEAK_DB + 0.001);
    });

    it("clamps the correction rather than amplifying near-silence", () => {
      // An unbounded single-pass correction would turn a nearly-silent take into
      // amplified room noise. A quiet voice stays quiet instead.
      const nearlySilent = 1e-6;
      const gain = voiceNormalizationGain(nearlySilent, 1e-5);
      expect(linearToDb(gain)).toBeLessThanOrEqual(18.001);
    });

    it("leaves an unmeasurable track alone", () => {
      expect(voiceNormalizationGain(0, 0)).toBe(1);
      expect(voiceNormalizationGain(Number.NaN, 1)).toBe(1);
    });
  });

  describe("ducking", () => {
    it("leaves the bed alone below the threshold", () => {
      // The music-only intro, the gaps between sentences and the ending all sit
      // here, at the full bed level.
      expect(duckGain(0)).toBe(1);
      expect(duckGain(DEVICE_MUSIC_DUCK_THRESHOLD * 0.5)).toBe(1);
    });

    it("pulls the bed down in proportion to how far speech exceeds it", () => {
      const quietSpeech = duckGain(DEVICE_MUSIC_DUCK_THRESHOLD * 2);
      const loudSpeech = duckGain(DEVICE_MUSIC_DUCK_THRESHOLD * 20);
      expect(quietSpeech).toBeLessThan(1);
      expect(loudSpeech).toBeLessThan(quietSpeech);
    });

    it("keeps the bed clearly present under speech, not buried", () => {
      // Ratio 2.5 was chosen after two rounds of the bed nearly disappearing
      // (it was 8, then 4). Speech at a normal level should land around -8 dB,
      // not -20.
      const underSpeech = linearToDb(duckGain(0.2));
      expect(underSpeech).toBeLessThan(0);
      expect(underSpeech).toBeGreaterThan(-14);
    });

    it("reduces by the ratio, in dB, exactly as sidechaincompress does", () => {
      const envelope = 0.3;
      const overDb = linearToDb(envelope) - linearToDb(DEVICE_MUSIC_DUCK_THRESHOLD);
      const expected = -(overDb - overDb / DEVICE_MUSIC_DUCK_RATIO);
      expect(linearToDb(duckGain(envelope))).toBeCloseTo(expected, 6);
    });
  });

  describe("envelope follower", () => {
    it("rises faster than it falls", () => {
      const sampleRate = 48_000;
      const attack = envelopeCoefficient(20, sampleRate);
      const release = envelopeCoefficient(300, sampleRate);
      // A larger coefficient means slower movement, so the release must be the
      // larger of the two — that asymmetry is what lets the bed drop promptly
      // on a syllable and recover between sentences.
      expect(release).toBeGreaterThan(attack);
    });

    it("covers most of the distance within one time constant", () => {
      const sampleRate = 48_000;
      const attack = envelopeCoefficient(20, sampleRate);
      const release = envelopeCoefficient(300, sampleRate);

      let envelope = 0;
      for (let i = 0; i < Math.round(0.02 * sampleRate); i++) {
        envelope = nextEnvelope(envelope, 1, attack, release);
      }
      expect(envelope).toBeGreaterThan(0.6);
      expect(envelope).toBeLessThan(0.7);

      // And then falls back on the slower release.
      const peak = envelope;
      for (let i = 0; i < Math.round(0.3 * sampleRate); i++) {
        envelope = nextEnvelope(envelope, 0, attack, release);
      }
      expect(envelope).toBeLessThan(peak * 0.4);
    });
  });

  describe("mixed track length", () => {
    it("runs for the whole picture when the montage outlasts the voice", () => {
      expect(
        mixedTrackDurationSeconds({ videoDurationSeconds: 20, voiceDurationSeconds: 12 })
      ).toBe(20);
    });

    it("never clips a voice that overruns the picture", () => {
      // `composeSingleRatio` takes the max precisely so the narration is never
      // cut; the picture-less remainder is covered by black frames.
      expect(
        mixedTrackDurationSeconds({ videoDurationSeconds: 10, voiceDurationSeconds: 12 })
      ).toBeCloseTo(12 + DEVICE_MUSIC_LEAD_IN_SECONDS, 5);
    });
  });
});
