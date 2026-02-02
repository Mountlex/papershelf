package com.carrel.app.core.cache

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL

/**
 * Singleton PDF cache with LRU eviction.
 * Caches PDFs by URL hash to avoid re-downloading.
 */
class PDFCache private constructor(private val cacheDir: File) {

    companion object {
        @Volatile
        private var instance: PDFCache? = null

        private const val MAX_FILE_SIZE = 50 * 1024 * 1024L // 50MB per file
        private const val MAX_TOTAL_SIZE = 500 * 1024 * 1024L // 500MB total cache

        fun getInstance(context: Context): PDFCache {
            return instance ?: synchronized(this) {
                instance ?: PDFCache(
                    File(context.cacheDir, "PDFCache").also {
                        it.mkdirs()
                    }
                ).also { instance = it }
            }
        }
    }

    private val mutex = Mutex()

    /**
     * Check if a PDF is cached without loading it.
     */
    fun isCached(url: String): Boolean {
        val cacheFile = cacheFileFor(url)
        return cacheFile.exists()
    }

    /**
     * Get cached PDF file if available.
     * Updates modification time for LRU tracking.
     */
    suspend fun getCachedPDF(url: String): File? = withContext(Dispatchers.IO) {
        val cacheFile = cacheFileFor(url)
        if (cacheFile.exists()) {
            // Update modification time for LRU tracking
            cacheFile.setLastModified(System.currentTimeMillis())
            cacheFile
        } else {
            null
        }
    }

    /**
     * Fetch PDF from URL, using cache if available.
     * Returns a File pointing to the cached PDF.
     */
    suspend fun fetchPDF(url: String): Result<File> = withContext(Dispatchers.IO) {
        runCatching {
            // Check cache first
            getCachedPDF(url)?.let { return@runCatching it }

            // Download from network
            val data = fetchWithRetry(url)

            // Validate file size
            if (data.size > MAX_FILE_SIZE) {
                throw PDFCacheException.FileTooLarge(data.size)
            }

            // Evict old files if needed
            mutex.withLock {
                evictIfNeeded(data.size.toLong())
            }

            // Save to cache
            val cacheFile = cacheFileFor(url)
            cacheFile.writeBytes(data)
            cacheFile
        }
    }

    private suspend fun fetchWithRetry(url: String, maxRetries: Int = 3): ByteArray {
        var lastError: Exception? = null
        repeat(maxRetries) { attempt ->
            try {
                return URL(url).openStream().use { it.readBytes() }
            } catch (e: Exception) {
                lastError = e
                if (attempt < maxRetries - 1) {
                    kotlinx.coroutines.delay(500L * (attempt + 1))
                }
            }
        }
        throw PDFCacheException.NetworkError(lastError!!)
    }

    /**
     * Clear all cached PDFs.
     */
    suspend fun clearCache() = withContext(Dispatchers.IO) {
        mutex.withLock {
            cacheDir.listFiles()?.forEach { it.delete() }
        }
    }

    /**
     * Get total cache size in bytes.
     */
    suspend fun cacheSize(): Long = withContext(Dispatchers.IO) {
        cacheDir.listFiles()?.sumOf { it.length() } ?: 0L
    }

    private fun cacheFileFor(url: String): File {
        // Use URL hash as filename to avoid path issues
        val hash = Base64.encodeToString(url.toByteArray(), Base64.NO_WRAP or Base64.URL_SAFE)
            .replace("/", "_")
            .replace("+", "-")
            .take(100) // Limit filename length
        return File(cacheDir, "$hash.pdf")
    }

    /**
     * Evict oldest files until cache is under the size limit.
     * Must be called within mutex lock.
     */
    private fun evictIfNeeded(bytesNeeded: Long) {
        val currentSize = cacheDir.listFiles()?.sumOf { it.length() } ?: 0L
        val targetSize = MAX_TOTAL_SIZE - bytesNeeded

        if (currentSize <= targetSize) return

        // Get all files with their modification times, sorted oldest first (LRU)
        val files = cacheDir.listFiles()
            ?.map { file -> file to file.lastModified() }
            ?.sortedBy { it.second }
            ?: return

        var freedBytes = 0L
        val bytesToFree = currentSize - targetSize

        for ((file, _) in files) {
            if (freedBytes >= bytesToFree) break
            val size = file.length()
            if (file.delete()) {
                freedBytes += size
            }
        }
    }
}

sealed class PDFCacheException(message: String) : Exception(message) {
    class FileTooLarge(size: Int) : PDFCacheException(
        "PDF file too large: ${size / 1024 / 1024}MB exceeds 50MB limit"
    )
    class NetworkError(cause: Exception) : PDFCacheException(
        "Network error: ${cause.message}"
    )
}
