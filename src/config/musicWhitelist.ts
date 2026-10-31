/**
 * Licensed music whitelist for LINE-intake and studio videos.
 * Only tracks in this list may be used; unlicensed music is rejected.
 *
 * All 20 tracks are from public/musics/.
 */

export const LICENSED_MUSIC_TRACKS = [
  'Bossa Nova Suave',
  'Brass Fanfare Bounce',
  'Buant Groove',
  'Cafe Reveal',
  'Cruncy Rock',
  'Digital Discovery',
  'Dub Shuffle',
  'Eastern Thunder',
  'Elegant Forward Motion',
  'Fresh and Intriguing',
  'Full Band Reveal',
  'Mellow Midrange',
  'New Excitement',
  'Progressive Flow',
  'Reveal Groove',
  'Reveal Time',
  'Revelation Found',
  'Ritmo Decisivo',
  'Warm Mid-Tempo Swing',
  'Warm Midrange Pulse',
] as const;

export type LicensedMusicTrack = (typeof LICENSED_MUSIC_TRACKS)[number];

const LICENSED_SET = new Set<string>(LICENSED_MUSIC_TRACKS);

/** Returns true if the track name is in the licensed whitelist. */
export function isLicensedMusic(trackName: string): boolean {
  // Match without .mp3 extension
  const base = trackName.replace(/\.mp3$/i, '').trim();
  return LICENSED_SET.has(base);
}

/** Validate a track selection; throws if not licensed. */
export function assertLicensedMusic(trackName: string): void {
  if (!isLicensedMusic(trackName)) {
    throw new Error(
      `Music track "${trackName}" is not in the licensed whitelist. ` +
        `Use one of: ${LICENSED_MUSIC_TRACKS.join(', ')}`
    );
  }
}

export const MUSIC_TRACK_COUNT = LICENSED_MUSIC_TRACKS.length;
