import { existsSync, readdirSync } from "fs";
import * as path from "path";
import {
  BACKGROUND_MUSIC_DIR,
  BACKGROUND_MUSIC_TRACKS,
  findMusicTrack,
  normalizeMusicTrackId,
} from "@/config/backgroundMusic";

const dir = path.join(process.cwd(), "public", BACKGROUND_MUSIC_DIR);

describe("background music catalog", () => {
  it("lists exactly the files in public/musics", () => {
    const onDisk = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp3")).sort();
    const inCatalog = BACKGROUND_MUSIC_TRACKS.map((t) => t.file).sort();
    expect(inCatalog).toEqual(onDisk);
  });

  it("has unique ids, no reserved 'none', and resolvable files and urls", () => {
    const ids = BACKGROUND_MUSIC_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("none");
    for (const t of BACKGROUND_MUSIC_TRACKS) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(existsSync(path.join(dir, t.file))).toBe(true);
      expect(t.url.startsWith("/musics/")).toBe(true);
      expect(decodeURIComponent(t.url.slice("/musics/".length))).toBe(t.file);
      expect(() => new URL(`https://rclipper.com${t.url}`)).not.toThrow();
    }
  });

  it("treats none, null and retired ids as no music", () => {
    expect(findMusicTrack(null)).toBeUndefined();
    expect(findMusicTrack("none")).toBeUndefined();
    expect(findMusicTrack("happy")).toBeUndefined();
    expect(findMusicTrack("bossa-nova-suave")?.file).toBe("Bossa Nova Suave.mp3");
    expect(normalizeMusicTrackId("none")).toBe("none");
    expect(normalizeMusicTrackId("happy")).toBeNull();
    expect(normalizeMusicTrackId(null)).toBeNull();
    expect(normalizeMusicTrackId("cafe-reveal")).toBe("cafe-reveal");
  });
});