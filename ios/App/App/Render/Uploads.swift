import Foundation

/// Uploading a finished render straight to object storage.
///
/// STREAMED, ALWAYS. `nativeDownload.ts` converts a whole response to base64 for
/// sharing; that is fine for a text file and catastrophic for a 60 MB export.
/// `URLSession.uploadTask(with:fromFile:)` streams from disk, so a part never
/// exists in memory as a whole — which is also why each part is written to its
/// own temporary slice rather than being read into `Data`.
enum Uploads {

    struct Part {
        let partNumber: Int
        let eTag: String
    }

    /// Upload a file to presigned part URLs, in order.
    ///
    /// Parts go up sequentially rather than in parallel: a phone on mobile data
    /// gains little from concurrency and loses a lot when four simultaneous
    /// uploads each stall, and sequential progress is honest progress.
    static func uploadParts(
        file: URL,
        partUrls: [String],
        partSizeBytes: Int,
        workDirectory: URL,
        onProgress: (Double) -> Void
    ) throws -> [Part] {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }

        let total = (try FileManager.default.attributesOfItem(atPath: file.path)[.size]
            as? NSNumber)?.intValue ?? 0
        var parts: [Part] = []
        var sent = 0

        for (index, urlString) in partUrls.enumerated() {
            let offset = index * partSizeBytes
            if offset >= total { break }

            guard let url = URL(string: urlString) else {
                throw RenderError.export("A presigned part URL is not usable")
            }

            try handle.seek(toOffset: UInt64(offset))
            let length = min(partSizeBytes, total - offset)
            let slice = try handle.read(upToCount: length) ?? Data()

            let sliceURL = workDirectory.appendingPathComponent("\(UUID().uuidString).part")
            try slice.write(to: sliceURL)
            defer { try? FileManager.default.removeItem(at: sliceURL) }

            var request = URLRequest(url: url)
            request.httpMethod = "PUT"

            let semaphore = DispatchSemaphore(value: 0)
            var eTag: String?
            var failure: Error?

            let task = URLSession.shared.uploadTask(with: request, fromFile: sliceURL) {
                _, response, error in
                defer { semaphore.signal() }
                if let error { failure = error; return }
                guard let http = response as? HTTPURLResponse,
                      (200...299).contains(http.statusCode) else {
                    let status = (response as? HTTPURLResponse)?.statusCode ?? -1
                    failure = RenderError.export("Upload part \(index + 1) returned \(status)")
                    return
                }
                // Without the ETag the multipart cannot be assembled, so a
                // missing one is fatal rather than something to paper over.
                eTag = http.value(forHTTPHeaderField: "ETag")
            }
            task.resume()
            semaphore.wait()

            if let failure { throw failure }
            guard let eTag, !eTag.isEmpty else {
                throw RenderError.export("Upload part \(index + 1) returned no ETag")
            }
            parts.append(Part(partNumber: index + 1, eTag: eTag))

            sent += length
            if total > 0 { onProgress(min(1, Double(sent) / Double(total))) }
        }
        return parts
    }

    /// A single presigned PUT — used for the small JPEG cover.
    static func put(file: URL, to urlString: String, contentType: String) throws {
        guard let url = URL(string: urlString) else {
            throw RenderError.export("The cover upload URL is not usable")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        let semaphore = DispatchSemaphore(value: 0)
        var failure: Error?
        let task = URLSession.shared.uploadTask(with: request, fromFile: file) {
            _, response, error in
            defer { semaphore.signal() }
            if let error { failure = error; return }
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                failure = RenderError.export(
                    "Cover upload returned \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                return
            }
        }
        task.resume()
        semaphore.wait()
        if let failure { throw failure }
    }
}
