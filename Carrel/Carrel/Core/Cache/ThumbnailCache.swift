import Foundation
import UIKit

actor ThumbnailCache {
    static let shared = ThumbnailCache()

    private let fileManager = FileManager.default
    private let cacheDirectory: URL
    private let memoryCache = NSCache<NSString, UIImage>()
    private let maxTotalDiskSize: Int64 = 100 * 1024 * 1024 // 100MB disk cache limit

    private init() {
        // Get caches directory, fallback to temp directory if unavailable (extremely rare on iOS)
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        cacheDirectory = caches.appendingPathComponent("ThumbnailCache", isDirectory: true)

        // Create cache directory if needed
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)

        memoryCache.countLimit = 50 // Keep ~50 thumbnails in memory
    }

    func fetchThumbnail(from url: URL) async throws -> UIImage {
        let cacheKey = url.absoluteString as NSString

        // Check memory cache first
        if let cached = memoryCache.object(forKey: cacheKey) {
            return cached
        }

        // Check disk cache
        let cacheFile = cacheFileURL(for: url)
        if fileManager.fileExists(atPath: cacheFile.path),
           let data = try? Data(contentsOf: cacheFile),
           let image = UIImage(data: data) {
            // Update modification date for LRU tracking
            try? fileManager.setAttributes(
                [.modificationDate: Date()],
                ofItemAtPath: cacheFile.path
            )
            memoryCache.setObject(image, forKey: cacheKey)
            return image
        }

        // Fetch from network with retry
        let data = try await fetchWithRetry(from: url)

        guard let image = UIImage(data: data) else {
            throw ThumbnailError.invalidImageData
        }

        // Evict old files if needed before caching new data
        evictIfNeeded(bytesNeeded: Int64(data.count))

        // Cache to disk
        try? data.write(to: cacheFile)

        // Cache to memory
        memoryCache.setObject(image, forKey: cacheKey)

        return image
    }

    func clearCache() {
        memoryCache.removeAllObjects()
        try? fileManager.removeItem(at: cacheDirectory)
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }

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
        return cacheDirectory.appendingPathComponent("\(hash).jpg")
    }

    private func fetchWithRetry(from url: URL, maxRetries: Int = 3) async throws -> Data {
        var lastError: Error?
        for attempt in 0..<maxRetries {
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw ThumbnailError.invalidResponse
                }
                guard (200...299).contains(httpResponse.statusCode) else {
                    throw ThumbnailError.badStatusCode(httpResponse.statusCode)
                }
                return data
            } catch {
                if let cacheError = error as? ThumbnailError, !cacheError.isRetryable {
                    throw cacheError
                }
                lastError = error
                // Don't retry on cancellation
                if Task.isCancelled { throw error }
                // Wait before retry with exponential backoff
                if attempt < maxRetries - 1 {
                    try await Task.sleep(for: .milliseconds(500 * (attempt + 1)))
                }
            }
        }
        throw ThumbnailError.networkError(underlying: lastError ?? URLError(.unknown))
    }

    // MARK: - LRU Eviction

    /// Evict oldest files until cache is under the size limit
    private func evictIfNeeded(bytesNeeded: Int64 = 0) {
        let currentSize = cacheSize()
        let targetSize = maxTotalDiskSize - bytesNeeded

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

enum ThumbnailError: Error, LocalizedError {
    case invalidImageData
    case networkError(underlying: Error)
    case invalidResponse
    case badStatusCode(Int)

    var errorDescription: String? {
        switch self {
        case .invalidImageData:
            return "Invalid image data"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid response from server"
        case .badStatusCode(let statusCode):
            return "Server returned status \(statusCode)"
        }
    }

    var isRetryable: Bool {
        switch self {
        case .badStatusCode(let statusCode):
            return (500...599).contains(statusCode)
        case .invalidResponse, .invalidImageData:
            return false
        case .networkError:
            return true
        }
    }
}
