import Foundation
import UIKit

actor ThumbnailCache {
    static let shared = ThumbnailCache()

    private let fileManager = FileManager.default
    private let cacheDirectory: URL
    private let memoryCache = NSCache<NSString, UIImage>()

    private init() {
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
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
            memoryCache.setObject(image, forKey: cacheKey)
            return image
        }

        // Fetch from network with retry
        let data = try await fetchWithRetry(from: url)

        guard let image = UIImage(data: data) else {
            throw ThumbnailError.invalidImageData
        }

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
        throw ThumbnailError.networkError(underlying: lastError!)
    }
}

enum ThumbnailError: Error, LocalizedError {
    case invalidImageData
    case networkError(underlying: Error)

    var errorDescription: String? {
        switch self {
        case .invalidImageData:
            return "Invalid image data"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}
