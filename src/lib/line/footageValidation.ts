import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertDurationAllowed } from '@/services/review/ReviewService';
export async function validateLineFootage(bytes: Buffer): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'line-footage-'));
  try {
    const file = join(directory, 'source.mp4');
    await writeFile(file, bytes);
    const { stdout } = await promisify(execFile)(process.env.FFPROBE_PATH ?? 'ffprobe',
      ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file], { timeout: 30000 });
    const seconds = Number(stdout.trim());
    assertDurationAllowed(seconds);
    return seconds;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
