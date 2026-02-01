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
    private let maxFileSize = 50 * 1024 * 1024 // 50MB

    private init() {
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
        cacheDirectory = caches.appendingPathComponent("PDFCache", isDirectory: true)

        // Create cache directory if needed
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }

    // Get cached PDF data if available
    func getCachedPDF(for url: URL) -> Data? {
        let cacheFile = cacheFileURL(for: url)
        guard fileManager.fileExists(atPath: cacheFile.path) else {
            return nil
        }
        return try? Data(contentsOf: cacheFile)
    }

    // Cache PDF data
    func cachePDF(_ data: Data, for url: URL) {
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
        throw PDFCacheError.networkError(underlying: lastError!)
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
}
