/**
 * The server's audio mix, restated as plain numbers and pure functions.
 *
 * WHY THIS FILE EXISTS. The merged master's sound is produced by one FFmpeg
 * filtergraph (`buildMusicMixFilters` in `src/lib/ai/ffmpegService.ts`):
 * loudness-normalise the voice, delay it by the music lead-in, pad it to the
 * full clip, split it so one branch keys a sidechain compressor, loop the music
 * under it, then mix and limit. Neither Media3 nor AVFoundation ships a
 * sidechain compressor, so both native engines have to implement the ducking
 * themselves — and if each one invents its own envelope follower, the phone
 * export stops sounding like the Mac export.
 *
 * So the maths lives here once, in testable TypeScript, and the Java and Swift
 * mixers implement exactly these formulas. The constants are re-exported from
 * the FFmpeg values rather than retyped, so a change on the server is a compile
 * error here rather than a silent drift.
 *
 * This module is client-safe: no Node APIs, no repository imports.
 */

/** Sample rate every native mixer works at, matching `-ar 48000`. */
export const DEVICE_MIX_SAMPLE_RATE = 48_000;

/** Music-only lead-in; the voice is delayed by this. `MUSIC_LEAD_IN_SECONDS`. */
export const DEVICE_MUSIC_LEAD_IN_SECONDS = 0.6;

/** Linear music bed level before ducking. `MUSIC_BED_VOLUME`. */
export const DEVICE_MUSIC_BED_VOLUME = 0.3;

/** `sidechaincompress` ratio — how far the bed drops under speech. */
export const DEVICE_MUSIC_DUCK_RATIO = 2.5;

/** `sidechaincompress` threshold, linear amplitude. */
export const DEVICE_MUSIC_DUCK_THRESHOLD = 0.03;

/** `sidechaincompress` attack, milliseconds. */
export const DEVICE_MUSIC_DUCK_ATTACK_MS = 20;

/** `sidechaincompress` release, milliseconds. */
export const DEVICE_MUSIC_DUCK_RELEASE_MS = 300;

/** `alimiter=limit=0.95` on the final mix. */
export const DEVICE_MIX_LIMIT = 0.95;

/** `loudnorm=I=-16` target integrated loudness, LUFS. */
export const DEVICE_VOICE_TARGET_LUFS = -16;

/** `loudnorm=LRA=11` target loudness range. Carried for completeness. */
export const DEVICE_VOICE_TARGET_LRA = 11;

/** `loudnorm=TP=-1.5` true-peak ceiling, dBTP. */
export const DEVICE_VOICE_TRUE_PEAK_DB = -1.5;

/**
 * Largest gain the single-pass voice normaliser may apply, in dB.
 *
 * FFmpeg's `loudnorm` runs two passes and can afford a large correction. A
 * phone mixes in one pass over a track it has just decoded, so an unbounded
 * correction would turn a near-silent recording into amplified room noise.
 * Clamping keeps a quiet voice quiet rather than making it wrong.
 */
export const DEVICE_VOICE_MAX_GAIN_DB = 18;

/** Smallest gain the voice normaliser may apply, in dB. */
export const DEVICE_VOICE_MIN_GAIN_DB = -18;

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-9));
}

/**
 * Single-pass approximation of `loudnorm=I=-16:TP=-1.5`.
 *
 * `loudnorm` measures ITU-R BS.1770 integrated loudness; a phone measures plain
 * RMS over the speech. Those differ by a roughly constant offset for a voice
 * track (BS.1770's K-weighting lifts the presence band that speech lives in),
 * so we treat measured RMS in dBFS as an estimate of LUFS, take the gain that
 * would hit the target, clamp it to a sane range, and then pull the gain back
 * if it would push the true peak above the ceiling. The result is the same
 * perceived speech level as the Mac export without a second analysis pass.
 *
 * @param rms   Linear RMS of the voice over its non-silent span, 0..1.
 * @param peak  Linear absolute peak of the voice, 0..1.
 * @returns     Linear gain to apply to every voice sample.
 */
export function voiceNormalizationGain(rms: number, peak: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 1;

  const measuredDb = linearToDb(rms);
  const wanted = DEVICE_VOICE_TARGET_LUFS - measuredDb;
  const clamped = Math.min(
    DEVICE_VOICE_MAX_GAIN_DB,
    Math.max(DEVICE_VOICE_MIN_GAIN_DB, wanted)
  );

  let gain = dbToLinear(clamped);

  const safePeak = Number.isFinite(peak) && peak > 0 ? peak : 0;
  if (safePeak > 0) {
    const ceiling = dbToLinear(DEVICE_VOICE_TRUE_PEAK_DB);
    if (safePeak * gain > ceiling) gain = ceiling / safePeak;
  }
  return gain;
}

/**
 * One-pole smoothing coefficient for an attack/release envelope follower.
 *
 * `exp(-1 / (timeConstantSeconds * sampleRate))` is the standard first-order
 * coefficient: the envelope covers 1 − 1/e of the distance to its target in one
 * time constant, which is what FFmpeg's compressor attack/release mean.
 */
export function envelopeCoefficient(timeMs: number, sampleRate: number): number {
  if (!(timeMs > 0) || !(sampleRate > 0)) return 0;
  return Math.exp(-1 / ((timeMs / 1000) * sampleRate));
}

/**
 * Advance the sidechain key envelope by one sample.
 *
 * Rises with the attack coefficient while the key is louder than the envelope
 * and falls with the release coefficient otherwise — the asymmetry is what lets
 * the music drop promptly on a syllable and recover between sentences.
 */
export function nextEnvelope(
  previous: number,
  keyAbs: number,
  attackCoefficient: number,
  releaseCoefficient: number
): number {
  const coefficient = keyAbs > previous ? attackCoefficient : releaseCoefficient;
  return keyAbs + coefficient * (previous - keyAbs);
}

/**
 * Gain applied to the music bed for a given sidechain envelope level.
 *
 * Mirrors `sidechaincompress=threshold=T:ratio=R`: below the threshold the bed
 * is untouched; above it, the amount by which the key exceeds the threshold is
 * divided by the ratio, in dB. With T = 0.03 and R = 2.5 a key at full scale
 * pulls the bed down by about 18 dB, and speech at a normal level lands around
 * −8 dB — audible, not gone, which is the level the pipeline settled on after
 * two rounds of complaints that the bed disappeared.
 *
 * @returns Linear gain multiplier in (0, 1].
 */
export function duckGain(
  envelope: number,
  threshold: number = DEVICE_MUSIC_DUCK_THRESHOLD,
  ratio: number = DEVICE_MUSIC_DUCK_RATIO
): number {
  if (!(envelope > threshold) || !(ratio > 1)) return 1;

  const overDb = linearToDb(envelope) - linearToDb(threshold);
  const reductionDb = overDb - overDb / ratio;
  return dbToLinear(-reductionDb);
}

/**
 * The full clip length the audio must cover, in seconds.
 *
 * `composeSingleRatio` runs the export for `max(video, voice + leadIn)`: the
 * montage normally outlasts the narration, but a voice that overruns must never
 * be clipped. Both native engines size their mixed track with this.
 */
export function mixedTrackDurationSeconds(params: {
  videoDurationSeconds: number;
  voiceDurationSeconds: number;
  leadInSeconds?: number;
}): number {
  const leadIn = params.leadInSeconds ?? DEVICE_MUSIC_LEAD_IN_SECONDS;
  const video = Number.isFinite(params.videoDurationSeconds) ? params.videoDurationSeconds : 0;
  const voice = Number.isFinite(params.voiceDurationSeconds) ? params.voiceDurationSeconds : 0;
  return Math.max(video, voice + leadIn);
}

/** Every mix parameter a native engine needs, as one serialisable object. */
export interface DeviceAudioMixSpec {
  sampleRate: number;
  leadInSeconds: number;
  musicBedVolume: number;
  duckThreshold: number;
  duckRatio: number;
  duckAttackMs: number;
  duckReleaseMs: number;
  limit: number;
  voiceTargetLufs: number;
  voiceTruePeakDb: number;
  voiceMaxGainDb: number;
}

/**
 * The mix spec carried in a manifest. `musicSelected: false` removes the
 * lead-in, exactly as the FFmpeg path does (`leadIn = hasMusic ? 0.6 : 0`).
 */
export function deviceAudioMixSpec(musicSelected: boolean): DeviceAudioMixSpec {
  return {
    sampleRate: DEVICE_MIX_SAMPLE_RATE,
    leadInSeconds: musicSelected ? DEVICE_MUSIC_LEAD_IN_SECONDS : 0,
    musicBedVolume: DEVICE_MUSIC_BED_VOLUME,
    duckThreshold: DEVICE_MUSIC_DUCK_THRESHOLD,
    duckRatio: DEVICE_MUSIC_DUCK_RATIO,
    duckAttackMs: DEVICE_MUSIC_DUCK_ATTACK_MS,
    duckReleaseMs: DEVICE_MUSIC_DUCK_RELEASE_MS,
    limit: DEVICE_MIX_LIMIT,
    voiceTargetLufs: DEVICE_VOICE_TARGET_LUFS,
    voiceTruePeakDb: DEVICE_VOICE_TRUE_PEAK_DB,
    voiceMaxGainDb: DEVICE_VOICE_MAX_GAIN_DB,
  };
}
