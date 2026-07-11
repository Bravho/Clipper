import * as path from "path";
import * as fs from "fs";

/**
 * Shared, process-cached Remotion bundle.
 *
 * Bundling the `remotion/` entry point (React + webpack) takes several seconds,
 * so it is done once per process, lazily, and reused by every renderer that
 * needs it (`remotionService` overlays and `montageService` scenes). Bundling
 * lazily (rather than at module load) keeps `npm test` and non-pipeline routes
 * fast, since this module is only imported dynamically from the pipeline.
 *
 * Two hardening measures below exist because the render worker is a LONG-RUNNING
 * process (days/weeks):
 *   1. The bundle is written to a STABLE dir under the working directory, not the
 *      OS temp dir. On macOS `/var/folders/.../T` is purged after ~3 days, which
 *      would delete a running worker's cached bundle out from under it — the next
 *      render then throws "index.html does not exist".
 *   2. The cached location is re-validated on every use; if the bundle dir has
 *      gone missing for any reason, it is transparently rebuilt instead of failing.
 */

let bundleLocationPromise: Promise<string> | null = null;

function bundleOutDir(): string {
  return path.join(process.cwd(), ".remotion-bundle");
}

async function buildBundle(): Promise<string> {
  const { bundle } = await import("@remotion/bundler");
  const outDir = bundleOutDir();
  // Clear any stale/partial contents so bundle() writes a clean tree.
  await fs.promises.rm(outDir, { recursive: true, force: true }).catch(() => {});
  return bundle({
    entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
    outDir,
    onProgress: () => {},
  });
}

export async function getRemotionBundle(): Promise<string> {
  // Reuse the cached bundle only if it still physically exists. A long-running
  // worker can outlive its bundle dir (OS temp cleanup, manual rm), after which
  // Remotion fails with "index.html does not exist" on every render. Detect the
  // missing bundle and rebuild transparently rather than serving a dead path.
  if (bundleLocationPromise) {
    try {
      const loc = await bundleLocationPromise;
      if (fs.existsSync(path.join(loc, "index.html"))) return loc;
    } catch {
      // Previous build rejected — fall through and rebuild.
    }
    bundleLocationPromise = null;
  }

  if (!bundleLocationPromise) {
    bundleLocationPromise = buildBundle();
  }
  return bundleLocationPromise;
}
