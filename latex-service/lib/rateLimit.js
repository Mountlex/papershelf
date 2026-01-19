const { LRUCache } = require("lru-cache");

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per key/IP
const RATE_LIMIT_MAX_ENTRIES = 10000; // Maximum entries in the LRU cache

// LRU cache for rate limiting - prevents unbounded memory growth
const rateLimitCache = new LRUCache({
  max: RATE_LIMIT_MAX_ENTRIES,
  ttl: RATE_LIMIT_WINDOW_MS,
});

/**
 * Rate limiting middleware.
 * Uses LRU cache to prevent memory leaks with bounded cache size.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function rateLimit(req, res, next) {
  // Use API key for rate limiting when available, otherwise fall back to IP
  // This prevents NAT issues where multiple mobile users share an IP
  const rateLimitKey = req.apiKey || req.ip || req.connection.remoteAddress;
  const now = Date.now();

  // Get or initialize record
  let record = rateLimitCache.get(rateLimitKey);

  if (!record) {
    record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitCache.set(rateLimitKey, record);
    setRateLimitHeaders(res, RATE_LIMIT_MAX_REQUESTS - 1, record.resetTime);
    return next();
  }

  // Check if window has expired
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW_MS;
    rateLimitCache.set(rateLimitKey, record);
    setRateLimitHeaders(res, RATE_LIMIT_MAX_REQUESTS - 1, record.resetTime);
    return next();
  }

  // Check if rate limit exceeded
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader("Retry-After", retryAfterSeconds);
    setRateLimitHeaders(res, 0, record.resetTime);
    return res.status(429).json({
      error: "Too many requests. Please try again later.",
      retryAfter: retryAfterSeconds,
    });
  }

  // Increment count
  record.count++;
  rateLimitCache.set(rateLimitKey, record);
  setRateLimitHeaders(res, RATE_LIMIT_MAX_REQUESTS - record.count, record.resetTime);
  next();
}

/**
 * Set rate limit headers on response.
 *
 * @param {Object} res - Express response object
 * @param {number} remaining - Remaining requests in window
 * @param {number} resetTime - Window reset timestamp
 */
function setRateLimitHeaders(res, remaining, resetTime) {
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000));
}

/**
 * Get current rate limit cache size (for monitoring).
 *
 * @returns {number}
 */
function getRateLimitCacheSize() {
  return rateLimitCache.size;
}

/**
 * Clear rate limit cache (for testing).
 */
function clearRateLimitCache() {
  rateLimitCache.clear();
}

module.exports = {
  rateLimit,
  getRateLimitCacheSize,
  clearRateLimitCache,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
};
