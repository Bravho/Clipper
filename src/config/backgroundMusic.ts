/**
 * Background-music catalog for the Sound section (web pickers and the phone
 * app's AudioPanel). Every track is a static file in `public/musics/`.
 *
 * `id` is what gets saved on a job (`video_generation_jobs.selected_music_track`)
 * and sent by clients, so it must stay stable once released. `file` is the exact
 * file name on disk, and
 * `url` is the same file as a percent-encoded public path, safe for <audio>, the
 * render manifest and the native render plugins.
 *
 * "none" is the explicit "no music" choice and is never a catalog id. Any other
 * id that is not in this list (for example a track from the retired
 * background-music set that was replaced, saved on an older job) resolves to no music; see
 * `findMusicTrack` and `normalizeMusicTrackId`.
 */
export interface MusicTrack {
  id: string;
  label: string;
  url: string;
  /** File name inside `public/musics/`. */
  file: string;
  /** Rough genre / mood, from the title. */
  mood?: string;
  /** Length of the file in seconds (ffprobe). The mix loops it as needed. */
  durationSeconds?: number;
}

/**
 * FILE NAMES: letters, digits, spaces, "-", "_" and "." only.
 *
 * "Fresh & Intriguing.mp3" played in a desktop browser but not in the phone
 * app — the only track whose name has a character that changes meaning when a
 * URL path is decoded and re-encoded on the way (the Capacitor WebView proxies
 * the app's requests to the server). A space survives that round trip; "&",
 * "#", "?", "%" and "+" are not safe to rely on. The file was renamed
 * "Fresh and Intriguing.mp3" — the id and the label are unchanged, so saved
 * jobs keep their choice. `tests/config/backgroundMusic.test.ts` refuses any
 * new file name outside this set.
 */
export const SAFE_MUSIC_FILE_NAME = /^[A-Za-z0-9 ._-]+\.mp3$/;

/** Folder under `public/` that holds the catalog's files. */
export const BACKGROUND_MUSIC_DIR = "musics";

/** The explicit "no background music" choice. */
export const NO_MUSIC_TRACK_ID = "none";

function track(
  id: string,
  label: string,
  file: string,
  mood: string,
  durationSeconds: number
): MusicTrack {
  return {
    id,
    label,
    file,
    url: `/${BACKGROUND_MUSIC_DIR}/${encodeURIComponent(file)}`,
    mood,
    durationSeconds,
  };
}

export const BACKGROUND_MUSIC_TRACKS: MusicTrack[] = [
  track("bossa-nova-suave",         "Bossa Nova Suave",         "Bossa Nova Suave.mp3",         "bossa nova, relaxed",   189.88),
  track("brass-fanfare-bounce",     "Brass Fanfare Bounce",     "Brass Fanfare Bounce.mp3",     "brass, upbeat",         189.28),
  track("buant-groove",             "Buant Groove",             "Buant Groove.mp3",             "groove, funky",         179.6),
  track("cafe-reveal",              "Café Reveal",              "Cafe Reveal.mp3",              "café, chill",           179.6),
  track("cruncy-rock",              "Cruncy Rock",              "Cruncy Rock.mp3",              "rock, energetic",       80.8),
  track("digital-discovery",        "Digital Discovery",        "Digital Discovery.mp3",        "electronic, tech",      178.84),
  track("dub-shuffle",              "Dub Shuffle",              "Dub Shuffle.mp3",              "dub, laid-back",        179.84),
  track("elegant-forward-motion",   "Elegant Forward Motion",   "Elegant Forward Motion.mp3",   "cinematic, elegant",    179.6),
  track("fresh-and-intriguing",     "Fresh & Intriguing",       "Fresh and Intriguing.mp3",     "pop, fresh",            180),
  track("full-band-reveal",         "Full Band Reveal",         "Full Band Reveal.mp3",         "full band, uplifting",  189.08),
  track("mellow-midrange",          "Mellow Midrange",          "Mellow Midrange.mp3",          "mellow, calm",          197.96),
  track("progressive-flow",         "Progressive Flow",         "Progressive Flow.mp3",         "electronic, driving",   184.88),
  track("reveal-groove",            "Reveal Groove",            "Reveal Groove.mp3",            "groove, upbeat",        184.6),
  track("reveal-time",              "Reveal Time",              "Reveal Time.mp3",              "upbeat, reveal",        178.88),
  track("revelation-found",         "Revelation Found",         "Revelation Found.mp3",         "cinematic, inspiring",  179.4),
  track("ritmo-decisivo",           "Ritmo Decisivo",           "Ritmo Decisivo.mp3",           "latin, energetic",      178.8),
  track("warm-mid-tempo-swing",     "Warm Mid-Tempo Swing",     "Warm Mid-Tempo Swing.mp3",     "swing, warm",           184.76),
  track("warm-midrange-pulse",      "Warm Midrange Pulse",      "Warm Midrange Pulse.mp3",      "warm, steady pulse",    179.92),
  track("sing-mai-thi-na-tuen-ten", "สิ่งใหม่ที่น่าตื่นเต้น",       "New Excitement.mp3",          "thai, exciting",        178.8),
  track("dongfang-jinglei",         "东方惊雷",                  "Eastern Thunder.mp3",         "chinese, dramatic",     178.8),
];

/**
 * The catalog track for an id, or undefined for null, "none" and any id that is
 * not in the current catalog (such as a retired track from the previous set, saved on
 * an old job). Every renderer treats undefined as "no background music".
 */
export function findMusicTrack(id: string | null | undefined): MusicTrack | undefined {
  if (!id || id === NO_MUSIC_TRACK_ID) return undefined;
  return BACKGROUND_MUSIC_TRACKS.find((t) => t.id === id);
}

/**
 * A saved selection made safe for a picker: a current track id or "none" is
 * kept, anything else (a retired track id) becomes null, i.e. "not chosen yet",
 * so the requester picks again instead of submitting an id the server rejects.
 */
export function normalizeMusicTrackId(id: string | null | undefined): string | null {
  if (id === NO_MUSIC_TRACK_ID) return NO_MUSIC_TRACK_ID;
  return findMusicTrack(id)?.id ?? null;
}
