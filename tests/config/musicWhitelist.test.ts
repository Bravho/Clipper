import {
  isLicensedMusic,
  assertLicensedMusic,
  LICENSED_MUSIC_TRACKS,
  MUSIC_TRACK_COUNT,
} from '@/config/musicWhitelist';

describe('musicWhitelist', () => {
  it('has exactly 20 tracks', () => {
    expect(MUSIC_TRACK_COUNT).toBe(20);
    expect(LICENSED_MUSIC_TRACKS).toHaveLength(20);
  });

  it('accepts every track in the list', () => {
    for (const track of LICENSED_MUSIC_TRACKS) {
      expect(isLicensedMusic(track)).toBe(true);
    }
  });

  it('accepts track name with .mp3 extension', () => {
    expect(isLicensedMusic('Bossa Nova Suave.mp3')).toBe(true);
  });

  it('accepts track name with .MP3 extension (case-insensitive)', () => {
    expect(isLicensedMusic('Cafe Reveal.MP3')).toBe(true);
  });

  it('rejects an unlicensed track', () => {
    expect(isLicensedMusic('Unlicensed Bangers Vol 1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isLicensedMusic('')).toBe(false);
  });

  it('assertLicensedMusic passes for valid track', () => {
    expect(() => assertLicensedMusic('Digital Discovery')).not.toThrow();
  });

  it('assertLicensedMusic throws for invalid track', () => {
    expect(() => assertLicensedMusic('Pirated Track')).toThrow('not in the licensed whitelist');
  });
});
