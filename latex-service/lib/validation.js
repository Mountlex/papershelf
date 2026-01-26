const path = require("path");
const fs = require("fs/promises");

// Configuration limits
const LIMITS = {
  MAX_RESOURCES: 300,
  MAX_RESOURCE_SIZE: 30 * 1024 * 1024, // 30MB per resource
  MAX_TOTAL_SIZE: 500 * 1024 * 1024, // 500MB total
  MAX_OUTPUT_SIZE: 10 * 1024 * 1024, // 10MB - generous for verbose LaTeX logs
  MAX_THUMBNAIL_WIDTH: 4000,
  MIN_THUMBNAIL_WIDTH: 1,
  // Repository archive limits (higher than compile limits to allow filtering)
  MAX_REPO_SIZE: 500 * 1024 * 1024, // 500MB
  MAX_REPO_FILES: 10000, // Support very large LaTeX projects with many figures
};

const ALLOWED_COMPILERS = ["pdflatex", "xelatex", "lualatex"];
const ALLOWED_THUMBNAIL_FORMATS = ["png", "jpeg"];

/**
 * Path traversal protection - ensures the resolved path is within the work directory.
 *
 * @param {string} workDir - The work directory (base path)
 * @param {string} userPath - The user-provided path (relative)
 * @returns {string|null} - The resolved safe path, or null if path is invalid
 */
function safePath(workDir, userPath) {
  // Reject obviously malicious paths early
  if (!userPath || typeof userPath !== "string") {
    return null;
  }

  // Reject paths with null bytes (common injection technique)
  if (userPath.includes("\0")) {
    return null;
  }

  // Reject absolute paths
  if (path.isAbsolute(userPath)) {
    return null;
  }

  // Normalize and resolve the path
  const resolved = path.resolve(workDir, userPath);

  // Ensure the resolved path starts with the work directory
  if (!resolved.startsWith(workDir + path.sep) && resolved !== workDir) {
    return null;
  }

  return resolved;
}

/**
 * Async version of safePath that also checks for symlink attacks.
 *
 * @param {string} workDir - The work directory (base path)
 * @param {string} userPath - The user-provided path (relative)
 * @returns {Promise<string|null>} - The resolved safe path, or null if path is invalid
 */
async function safePathAsync(workDir, userPath) {
  const resolved = safePath(workDir, userPath);
  if (!resolved) {
    return null;
  }

  try {
    // Check if the path exists and is a symlink pointing outside workDir
    const stat = await fs.lstat(resolved).catch(() => null);
    if (stat && stat.isSymbolicLink()) {
      const realPath = await fs.realpath(resolved);
      if (!realPath.startsWith(workDir + path.sep) && realPath !== workDir) {
        return null;
      }
    }
  } catch {
    // Path doesn't exist yet, that's fine for write operations
  }

  return resolved;
}

/**
 * Validate target .tex file path.
 *
 * @param {string} target - The target file path
 * @returns {{valid: boolean, error?: string}}
 */
function validateTarget(target) {
  if (!target || typeof target !== "string") {
    return { valid: false, error: "Missing target file" };
  }
  if (!target.endsWith(".tex")) {
    return { valid: false, error: "Target must be a .tex file" };
  }
  if (target.includes("..") || path.isAbsolute(target)) {
    return { valid: false, error: "Invalid target path" };
  }
  return { valid: true };
}

/**
 * Validate compiler option.
 *
 * @param {string} compiler - The compiler name
 * @returns {{valid: boolean, error?: string}}
 */
function validateCompiler(compiler) {
  if (!ALLOWED_COMPILERS.includes(compiler)) {
    return {
      valid: false,
      error: `Invalid compiler. Use: ${ALLOWED_COMPILERS.join(", ")}`,
    };
  }
  return { valid: true };
}

/**
 * Validate thumbnail generation options.
 *
 * @param {Object} options - The thumbnail options
 * @param {number} [options.width] - Thumbnail width
 * @param {string} [options.format] - Thumbnail format
 * @returns {{valid: boolean, error?: string}}
 */
function validateThumbnailOptions({ width, format }) {
  if (width !== undefined) {
    if (typeof width !== "number" || !Number.isInteger(width)) {
      return { valid: false, error: "Width must be an integer" };
    }
    if (width < LIMITS.MIN_THUMBNAIL_WIDTH || width > LIMITS.MAX_THUMBNAIL_WIDTH) {
      return {
        valid: false,
        error: `Width must be between ${LIMITS.MIN_THUMBNAIL_WIDTH} and ${LIMITS.MAX_THUMBNAIL_WIDTH}`,
      };
    }
  }

  if (format !== undefined && !ALLOWED_THUMBNAIL_FORMATS.includes(format)) {
    return {
      valid: false,
      error: `Invalid format. Use: ${ALLOWED_THUMBNAIL_FORMATS.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Validate git URL.
 *
 * @param {string} gitUrl - The git URL
 * @returns {{valid: boolean, error?: string}}
 */
function validateGitUrl(gitUrl) {
  if (!gitUrl || typeof gitUrl !== "string") {
    return { valid: false, error: "Missing gitUrl" };
  }

  // Basic URL validation
  let parsed;
  try {
    parsed = new URL(gitUrl);
  } catch {
    return { valid: false, error: "Invalid gitUrl format" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Invalid gitUrl protocol" };
  }

  const hostname = parsed.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
    return { valid: false, error: "Invalid gitUrl host" };
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((o) => Number(o));
    const [a, b] = octets;
    if (octets.some((o) => o < 0 || o > 255)) {
      return { valid: false, error: "Invalid gitUrl host" };
    }
    const isPrivate = a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254);
    if (isPrivate) {
      return { valid: false, error: "Invalid gitUrl host" };
    }
  }

  return { valid: true };
}

/**
 * Validate file path for git operations.
 *
 * @param {string} filePath - The file path
 * @returns {{valid: boolean, error?: string}}
 */
function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return { valid: false, error: "Missing filePath" };
  }

  // Reject absolute paths and path traversal
  if (path.isAbsolute(filePath) || filePath.includes("..")) {
    return { valid: false, error: "Invalid filePath" };
  }

  return { valid: true };
}

module.exports = {
  LIMITS,
  ALLOWED_COMPILERS,
  ALLOWED_THUMBNAIL_FORMATS,
  safePath,
  safePathAsync,
  validateTarget,
  validateCompiler,
  validateThumbnailOptions,
  validateGitUrl,
  validateFilePath,
};
