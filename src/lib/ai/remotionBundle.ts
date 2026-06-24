import * as path from "path";

/**
 * Shared, process-cached Remotion bundle.
 *
 * Bundling the `remotion/` entry point (React + webpack) takes several seconds,
 * so it is done once per process, lazily, and reused by every renderer that
 * needs it (`remotionService` overlays and `montageService` scenes). Bundling
 * lazily (rather than at module load) keeps `npm test` and non-pipeline routes
 * fast, since this module is only imported dynamically from the pipeline.
 */

let bundleLocationPromise: Promise<string> | null = null;

export function getRemotionBundle(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
        onProgress: () => {},
      });
    })();
  }
  return bundleLocationPromise;
}
