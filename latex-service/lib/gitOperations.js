/**
 * Git operations helpers for repository cloning.
 */

const fs = require("fs/promises");
const { spawnAsync } = require("./subprocess");

/**
 * Clone a git repository to a work directory.
 *
 * @param {Object} options - Clone options
 * @param {string} options.authenticatedUrl - Git URL with credentials embedded
 * @param {string} options.workDir - Target directory for clone
 * @param {string} [options.branch] - Branch to clone (optional)
 * @param {number} [options.timeout=60000] - Clone timeout in milliseconds
 * @param {Object} [options.logger] - Logger instance
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function cloneRepository({ authenticatedUrl, workDir, branch, timeout = 60000, logger }) {
  await fs.mkdir(workDir, { recursive: true });

  const cloneArgs = ["clone", "--depth", "1"];
  if (branch) {
    cloneArgs.push("--branch", branch);
  }
  cloneArgs.push(authenticatedUrl, workDir);

  const result = await spawnAsync("git", cloneArgs, {
    timeout,
    logger,
  });

  if (!result.success) {
    return { success: false, error: result.stderr || "Failed to clone repository" };
  }

  return { success: true };
}

/**
 * Binary file extensions that should be skipped when reading repository content.
 */
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".ico",
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
]);

/**
 * Check if a file path has a binary extension.
 *
 * @param {string} filePath - File path to check
 * @returns {boolean} True if the file is likely binary
 */
function isBinaryFile(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

module.exports = {
  cloneRepository,
  BINARY_EXTENSIONS,
  isBinaryFile,
};
