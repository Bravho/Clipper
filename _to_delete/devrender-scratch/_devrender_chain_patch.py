"""Let a staged source be a previous stage's OUTPUT, not only a staged original.

The render chain is montage -> master -> final, and each stage's result is the
next stage's input. On device that input is handed over as a staged source under
the reserved key "input", so the path validation has to accept an `-output.mp4`
in the render directory as well as a `-source.*` copy. Without this the chain
fails at the second stage with "Invalid staged source path", which reads like a
security error and is really an off-by-one in what the guard allows.

The guard still confines every accepted path to the plugin's own render
directory, which is the part that matters.
"""

import io

# ── Android ─────────────────────────────────────────────────────────────────
p = "android/app/src/main/java/com/rclipper/app/DeviceVideoRenderPlugin.java"
s = io.open(p, encoding="utf-8").read()

old = '''                    staged.put(entry.getString("key"), validStagedFile(entry.getString("sourceUrl")));'''
assert s.count(old) == 1, "android staged anchor"
new = '''                    staged.put(entry.getString("key"), validRenderInput(entry.getString("sourceUrl")));'''
s = s.replace(old, new, 1)

anchor = '''    private File validStagedFile(String raw) throws Exception {'''
assert s.count(anchor) == 1, "android validStagedFile anchor"
addition = '''    /**
     * A file a manifest render may read: a staged copy of a device-private
     * original, OR a previous stage's output being chained into the next one.
     *
     * Both live in this plugin's render directory and nowhere else, which is the
     * guarantee worth keeping — the file NAME is a convenience, the parent
     * directory check is the security boundary.
     */
    private File validRenderInput(String raw) throws Exception {
        if (raw == null || !raw.startsWith("file://")) throw new Exception("Missing staged source");
        File file = new File(Uri.parse(raw).getPath()).getCanonicalFile();
        boolean named = file.getName().matches("[0-9a-fA-F-]+-source\\\\.(bin|mp3|m4a|wav|mp4)")
            || file.getName().matches("[0-9a-fA-F-]+-output\\\\.mp4")
            || file.getName().matches("[0-9a-fA-F-]+-mix\\\\.m4a");
        if (!renderDirectory().equals(file.getParentFile()) || !named || !file.isFile()) {
            throw new Exception("Invalid staged source path");
        }
        return file;
    }

'''
s = s.replace(anchor, addition + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("android chain patch applied")

# ── iOS ─────────────────────────────────────────────────────────────────────
p = "ios/App/App/DeviceVideoRenderPlugin.swift"
s = io.open(p, encoding="utf-8").read()

old = '''                      let url = URL(string: raw), url.isFileURL, validStagedSource(url) else {'''
assert s.count(old) == 1, "ios staged anchor"
new = '''                      let url = URL(string: raw), url.isFileURL, validRenderInput(url) else {'''
s = s.replace(old, new, 1)

anchor = '''    private func validStagedSource(_ url: URL) -> Bool {'''
assert s.count(anchor) == 1, "ios validStagedSource anchor"
addition = '''    /// A file a manifest render may read: a staged copy of a device-private
    /// original, OR a previous stage's output being chained into the next one.
    ///
    /// Both live in this plugin's render directory and nowhere else, which is
    /// the guarantee worth keeping — the file NAME is a convenience, the parent
    /// directory check is the security boundary.
    private func validRenderInput(_ url: URL) -> Bool {
        guard let directory = try? renderDirectory() else { return false }
        guard url.standardizedFileURL.deletingLastPathComponent()
            == directory.standardizedFileURL else { return false }
        let name = url.lastPathComponent
        if DeviceVideoRenderPlugin.stagedSourceSuffixes.contains(where: { name.hasSuffix($0) }) {
            return true
        }
        return name.hasSuffix("-output.mp4") || name.hasSuffix("-mix.m4a")
    }

'''
s = s.replace(anchor, addition + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ios chain patch applied")
