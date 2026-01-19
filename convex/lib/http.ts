// Shared HTTP utilities for Convex actions

// Type for file dependency with its git blob hash (used for change detection)
export type DependencyHash = { path: string; hash: string };

// Default timeout for API requests (30 seconds)
export const DEFAULT_API_TIMEOUT = 30000;

// Default timeout for batch operations (60 seconds)
export const BATCH_OPERATION_TIMEOUT = 60000;

// Default timeout for latex service requests (3 minutes)
export const DEFAULT_LATEX_SERVICE_TIMEOUT = 180000;

// Default timeout for thumbnail generation (30 seconds)
export const THUMBNAIL_TIMEOUT = 30000;

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Fetch with timeout using AbortSignal
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
  defaultTimeout = DEFAULT_API_TIMEOUT
): Promise<Response> {
  const { timeout = defaultTimeout, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sleep helper for retry backoff
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff
 * Only retries on server errors (5xx) or network issues, not on client errors (4xx)
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeout?: number } = {},
  maxRetries = 3,
  defaultTimeout = DEFAULT_API_TIMEOUT
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, defaultTimeout);
      // Don't retry on client errors (4xx), only on server errors (5xx) or network issues
      if (response.ok || response.status < 500) {
        return response;
      }
      // Server error - will retry
      lastError = new Error(`Server error: ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Don't retry on timeout for long operations
      if (lastError.message.includes("timed out")) {
        throw lastError;
      }
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < maxRetries - 1) {
      const backoffMs = Math.pow(2, attempt) * 1000;
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }

  throw lastError || new Error("Request failed after retries");
}

/**
 * Get headers for LaTeX service requests (includes API key if configured)
 */
export function getLatexServiceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.LATEX_SERVICE_API_KEY;
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}
