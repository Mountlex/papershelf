import Foundation
import PDFKit

enum PDFCacheError: Error, LocalizedError {
    case invalidURL
    case fileTooLarge(size: Int)
    case networkError(underlying: Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL for caching"
        case .fileTooLarge(let size):
            return "PDF file too large: \(size / 1024 / 1024)MB exceeds 50MB limit"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

actor PDFCache {
    static let shared = PDFCache()

    private let fileManager = FileManager.default
    private let cacheDirectory: URL
    private let maxFileSize = 50 * 1024 * 1024 // 50MB per file
    private let maxTotalSize: Int64 = 500 * 1024 * 1024 // 500MB total cache limit

    private init() {
        // Get caches directory, fallback to temp directory if unavailable (extremely rare on iOS)
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        cacheDirectory = caches.appendingPathComponent("PDFCache", isDirectory: true)

        // Create cache directory if needed
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }

    // Check if a PDF is cached without loading it
    func isCached(url: URL) -> Bool {
        let cacheFile = cacheFileURL(for: url)
        return fileManager.fileExists(atPath: cacheFile.path)
    }

    // Get cached PDF data if available
    func getCachedPDF(for url: URL) -> Data? {
        let cacheFile = cacheFileURL(for: url)
        guard fileManager.fileExists(atPath: cacheFile.path) else {
            return nil
        }

        // Update modification date for LRU tracking
        try? fileManager.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: cacheFile.path
        )

        return try? Data(contentsOf: cacheFile)
    }

    // Cache PDF data
    func cachePDF(_ data: Data, for url: URL) {
        // Evict old files if needed before caching new data
        evictIfNeeded(bytesNeeded: Int64(data.count))

        let cacheFile = cacheFileURL(for: url)
        try? data.write(to: cacheFile)
    }

    // Fetch PDF, using cache if available
    func fetchPDF(from url: URL) async throws -> Data {
        // Check cache first
        if let cached = getCachedPDF(for: url) {
            return cached
        }

        // Fetch from network with retry
        let data = try await fetchWithRetry(from: url)

        // Validate file size
        guard data.count <= maxFileSize else {
            throw PDFCacheError.fileTooLarge(size: data.count)
        }

        // Cache for next time
        cachePDF(data, for: url)

        return data
    }

    private func fetchWithRetry(from url: URL, maxRetries: Int = 3) async throws -> Data {
        var lastError: Error?
        for attempt in 0..<maxRetries {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                return data
            } catch {
                lastError = error
                // Don't retry on cancellation
                if Task.isCancelled { throw error }
                // Wait before retry with exponential backoff
                if attempt < maxRetries - 1 {
                    try await Task.sleep(for: .milliseconds(500 * (attempt + 1)))
                }
            }
        }
        throw PDFCacheError.networkError(underlying: lastError ?? URLError(.unknown))
    }

    // Clear all cached PDFs
    func clearCache() {
        try? fileManager.removeItem(at: cacheDirectory)
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }

    // Get cache size in bytes
    func cacheSize() -> Int64 {
        guard let files = try? fileManager.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: [.fileSizeKey]) else {
            return 0
        }

        return files.reduce(0) { total, file in
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            return total + Int64(size)
        }
    }

    private func cacheFileURL(for url: URL) -> URL {
        // Use URL hash as filename to avoid path issues
        // UTF-8 encoding of a string should always succeed, but use fallback for safety
        let urlString = url.absoluteString
        let hash = (urlString.data(using: .utf8) ?? Data(urlString.utf8)).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
        return cacheDirectory.appendingPathComponent("\(hash).pdf")
    }

    // MARK: - LRU Eviction

    /// Evict oldest files until cache is under the size limit
    private func evictIfNeeded(bytesNeeded: Int64 = 0) {
        let currentSize = cacheSize()
        let targetSize = maxTotalSize - bytesNeeded

        guard currentSize > targetSize else { return }

        // Get all files with their modification dates
        guard let files = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]
        ) else { return }

        // Sort by modification date (oldest first) for LRU eviction
        let sortedFiles = files.compactMap { url -> (url: URL, date: Date, size: Int64)? in
            guard let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
                  let date = values.contentModificationDate,
                  let size = values.fileSize else { return nil }
            return (url, date, Int64(size))
        }.sorted { $0.date < $1.date }

        var freedBytes: Int64 = 0
        let bytesToFree = currentSize - targetSize

        for file in sortedFiles {
            guard freedBytes < bytesToFree else { break }
            try? fileManager.removeItem(at: file.url)
            freedBytes += file.size
        }
    }
}
