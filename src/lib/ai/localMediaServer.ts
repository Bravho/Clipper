import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { once } from "events";
import type { AddressInfo } from "net";

/**
 * Serve ONE local media file to Remotion over loopback HTTP.
 *
 * WHY THIS EXISTS. Remotion's `OffthreadVideo` takes a URL, and its asset
 * downloader (`@remotion/renderer/dist/assets/read-file.js`) accepts only
 * `http://` and `https://` — a `file://` URL or a bare path throws
 * "Can only download URLs starting with http:// or https://". So a master
 * already sitting on the worker's disk cannot be handed to Remotion directly;
 * it has to be served.
 *
 * Serving it on 127.0.0.1 means the render reads the master over loopback
 * instead of pulling it from DO Spaces in Singapore, which is what the
 * per-ratio renders were doing once per ratio.
 *
 * The server binds to 127.0.0.1 on an ephemeral port and exposes exactly one
 * path, so nothing outside this machine can reach it and no other file is
 * exposed even to callers on it.
 */

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
  const { size } = await fs.promises.stat(filePath);

  const server = http.createServer((req, res) => {
    // Exactly one resource is served; anything else is a 404 rather than a
    // path that could be talked into reading elsewhere on disk.
    const urlPath = (req.url ?? "").split("?")[0];
    if (urlPath !== ONE_PATH) {
      res.writeHead(404).end();
      return;
    }

    const common = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    };

    if (req.method === "HEAD") {
      res.writeHead(200, { ...common, "Content-Length": String(size) }).end();
      return;
    }

    // Range support: Remotion currently issues a plain GET, but ffmpeg-backed
    // readers seek, and an unhandled Range would silently yield a truncated
    // or wrong-offset read rather than an error.
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
        // Suffix range: the last N bytes.
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

    const stream = fs.createReadStream(filePath, { start, end });
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

  try {
    return await fn(`http://127.0.0.1:${port}${ONE_PATH}`);
  } finally {
    // Destroy live sockets too — `close()` alone waits for keep-alive
    // connections and would hang the step.
    server.closeAllConnections?.();
    server.close();
    await once(server, "close").catch(() => {});
  }
}

/**
 * Best-effort removal of a temp directory holding a downloaded master.
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
