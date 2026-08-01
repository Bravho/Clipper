import {
  attachmentContentDisposition,
  sanitizeDownloadFileName,
} from "@/lib/downloadHeaders";

describe("download attachment headers", () => {
  it("uses filename* for a Thai UTF-8 name and keeps the header ASCII-safe", () => {
    const header = attachmentContentDisposition(
      "บ้านไร่ยามเย็น - Instagram.mp4"
    );

    expect(header).toContain('filename="Instagram.mp4"');
    expect(header).toContain("filename*=UTF-8''%E0%B8%9A");
    expect(/^[\x20-\x7e]+$/.test(header)).toBe(true);
  });

  it("removes control characters, quotes, and path separators", () => {
    expect(sanitizeDownloadFileName('..\\bad/"name\r\n.mp4')).toBe(
      "..badname.mp4"
    );
  });

  it("falls back to a safe name when nothing usable remains", () => {
    expect(sanitizeDownloadFileName('\r\n"\\/')).toBe("rclipper-video.mp4");
    expect(attachmentContentDisposition("วิดีโอ.mp4")).toContain(
      'filename="rclipper-video.mp4"'
    );
  });
});
