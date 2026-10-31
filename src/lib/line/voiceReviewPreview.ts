import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spacesSignedUrl } from '@/lib/spaces';
import { uploadLineAsset } from './lineStorage';
// A video container is required by LINE's player. No AI/provider call is made.
export async function createVoiceReviewMp4(storageKey: string, destination: string): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'line-voice-review-'));
  try {
    const path = join(directory, 'voice.mp4');
    await promisify(execFile)(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y', '-f', 'lavfi', '-i',
      'color=c=black:s=640x360:r=10', '-i', await spacesSignedUrl(storageKey, 300),
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-t', '90', '-movflags', '+faststart', path], { timeout: 120000 });
    const bytes = await readFile(path);
    await uploadLineAsset({ key: destination, body: bytes, contentType: 'video/mp4' });
    return bytes.length;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
