const DEFAULT_DOWNLOAD_NAME = "rclipper-video.mp4";

/**
 * Remove characters that can escape a Content-Disposition filename or create a
 * path when the same value is used by a native client.
 */
export function sanitizeDownloadFileName(
  fileName: string,
  fallback = DEFAULT_DOWNLOAD_NAME
): string {
  const cleaned = fileName
    .replace(/[\u0000-\u001f\u007f"\\/]+/g, "")
    .trim()
    .slice(0, 200);

  return cleaned || fallback;
}

/**
 * Build an RFC 6266 / RFC 5987 attachment header.
 *
 * HTTP header values must be ASCII-safe. `filename` is therefore a conservative
 * fallback, while `filename*` carries the real UTF-8 name (including Thai) for
 * modern browsers.
 */
export function attachmentContentDisposition(fileName: string): string {
  const safeName = sanitizeDownloadFileName(fileName);
  const extension = safeName.match(/(\.[A-Za-z0-9]{1,10})$/)?.[1] ?? ".mp4";
  const stem = safeName.endsWith(extension)
    ? safeName.slice(0, -extension.length)
    : safeName;
  const asciiStem = stem
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\]/g, "")
      .replace(/^[\s._-]+/, "")
      .trim()
      .slice(0, Math.max(1, 200 - extension.length));
  const asciiName = asciiStem
    ? `${asciiStem}${extension}`
    : `rclipper-video${extension}`;
  const encodedName = encodeURIComponent(safeName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
