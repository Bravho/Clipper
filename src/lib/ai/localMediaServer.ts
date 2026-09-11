import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { once } from "events";
import type { AddressInfo } from "net";
import { RENDER_TUNING } from "@/config/renderTuning";

/**
 * Serve local media files to Remotion over loopback HTTP.
 *
 * WHY THIS EXISTS. Remotion's `OffthreadVideo`/`Img` take a URL, and its asset
 * downloader (`@remotion/renderer/dist/assets/read-file.js`) accepts only
 * `http://` and `https://` — a `file://` URL or a bare path throws
 * "Can only download URLs starting with http:// or https://". So media already
 * sitting on the worker's disk cannot be handed to Remotion directly; it has to
 * be served.
 *
 * Serving on 127.0.0.1 means the render reads from disk instead of pulling from
 * DO Spaces in Singapore. Two users:
 *   - `withLocalMediaUrl` — one file, for a ratio's merged master.
 *   - `withLocalAssetCache` — many files, for the requester's source photos and
 *     clips, which Remotion otherwise re-downloads for every scene render and
 *     every ratio (each render keeps its own download cache).
 *
 * Both bind to 127.0.0.1 on an ephemeral port and serve only files they were
 * explicitly given, so nothing else on disk is reachable even from this machine.
 */

interface ServedFile {
  filePath: string;
  contentType: string;
}

/** Starts a loopback server resolving request paths through `lookup`. */
async function startServer(
  lookup: (urlPath: string) => ServedFile | undefined
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "").split("?")[0];
    const entry = lookup(urlPath);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }

    let size: number;
    try {
      size = fs.statSync(entry.filePath).size;
    } catch {
      res.writeHead(404).end();
      return;
    }

    const common = { "Content-Type": entry.contentType, "Accept-Ranges": "bytes" };

    if (req.method === "HEAD") {
      res.writeHead(200, { ...common, "Content-Length": String(size) }).end();
      return;
    }

    // Range support: Remotion currently issues a plain GET, but ffmpeg-backed
    // readers seek, and an unhandled Range would silently yield a truncated or
    // wrong-offset read rather than an error.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = size - 1;
    if (range) {
      const [, rawStart, rawEnd] = range;
      if (rawStart === "" && rawEnd === "") {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      if (rawStart === "") {
        start = Math.max(0, size - Number(rawEnd));
      } else {
        start = Number(rawStart);
        if (rawEnd !== "") end = Math.min(end, Number(rawEnd));
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
    }

    res.writeHead(range ? 206 : 200, {
      ...common,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });

    const stream = fs.createReadStream(entry.filePath, { start, end });
    // A client that hangs up mid-render (cancelled render, killed worker) must
    // not leave the read stream open.
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });

  // 127.0.0.1, not 0.0.0.0: loopback only.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    port,
    close: async () => {
      // Destroy live sockets too — `close()` alone waits for keep-alive
      // connections and would hang the step.
      server.closeAllConnections?.();
      server.close();
      await once(server, "close").catch(() => {});
    },
  };
}

const ONE_PATH = "/master";

/**
 * Runs `fn` with an `http://127.0.0.1:<port>/master` URL that streams
 * `filePath`, and shuts the server down afterwards — including when `fn`
 * throws, so a failed render never leaks a listening socket.
 */
export async function withLocalMediaUrl<T>(
  filePath: string,
  contentType: string,
  fn: (url: string) => Promise<T>
): Promise<T> {
  const entry: ServedFile = { filePath, contentType };
  const server = await startServer((p) => (p === ONE_PATH ? entry : undefined));
  try {
    return await fn(`http://127.0.0.1:${server.port}${ONE_PATH}`);
  } finally {
    await server.close();
  }
}

/** Content type from a URL's extension — Remotion names its copy from this. */
function contentTypeForUrl(url: string): string {
  const ext = (url.split("?")[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  switch (ext) {
    case "mp4": case "m4v": return "video/mp4";
    case "mov": return "video/quicktime";
    case "webm": return "video/webm";
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "heic": return "image/heic";
    default: return "application/octet-stream";
  }
}

export interface LocalAssetCache {
  /**
   * Returns a loopback URL serving `originalUrl` from disk, downloading it on
   * first request. Returns `originalUrl` unchanged if the download fails or
   * caching is disabled — so a caller can always use the result directly.
   */
  ensure(originalUrl: string): Promise<string>;
}

/** A cache that changes nothing — used when caching is off. */
const PASSTHROUGH_CACHE: LocalAssetCache = { ensure: async (url) => url };

/**
 * Runs `fn` with a cache of the requester's source media, held on local disk
 * and served over loopback for the duration.
 *
 * Scope this to a whole step, not to one ratio: the scenes within a ratio use
 * DIFFERENT photos, so the saving comes entirely from the later ratios reusing
 * what the first ratio already fetched.
 *
 * The temp directory and the server are both torn down in a `finally`.
 */
export async function withLocalAssetCache<T>(
  fn: (cache: LocalAssetCache) => Promise<T>
): Promise<T> {
  if (!RENDER_TUNING.assetCacheEnabled) return fn(PASSTHROUGH_CACHE);

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "clipper-assets-"));
  const byPath = new Map<string, ServedFile>();
  // One promise per source URL, so concurrent scenes asking for the same asset
  // download it once rather than racing each other to the same file.
  const inFlight = new Map<string, Promise<string>>();

  const server = await startServer((p) => byPath.get(p));

  let nextId = 0;
  const cache: LocalAssetCache = {
    ensure(originalUrl: string): Promise<string> {
      if (!/^https?:\/\//i.test(originalUrl)) return Promise.resolve(originalUrl);
      const existing = inFlight.get(originalUrl);
      if (existing) return existing;

      const started = (async () => {
        const urlPath = `/asset/${nextId++}`;
        const filePath = path.join(dir, path.basename(urlPath));
        try {
          const res = await fetch(originalUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await fs.promises.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
          byPath.set(urlPath, { filePath, contentType: contentTypeForUrl(originalUrl) });
          return `http://127.0.0.1:${server.port}${urlPath}`;
        } catch (err) {
          // Per-asset fallback: this one asset keeps its Spaces URL and Remotion
          // fetches it as before. One unreachable photo must not fail a render.
          console.error(`[assetcache] could not cache ${originalUrl}, using it directly:`, err);
          return originalUrl;
        }
      })();

      inFlight.set(originalUrl, started);
      return started;
    },
  };

  try {
    return await fn(cache);
  } finally {
    await server.close();
    await discardTempDir(dir);
  }
}

/**
 * Best-effort removal of a temp directory holding downloaded media.
 *
 * Deliberately never throws: cleanup failing must not fail a render that
 * already produced its output, and must not mask the original error when it is
 * called from a `finally` after a failure.
 */
export async function discardTempDir(dir: string | null): Promise<void> {
  if (!dir) return;
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[localmedia] failed to remove temp dir ${path.basename(dir)}:`, err);
  }
}
