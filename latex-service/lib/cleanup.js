const fs = require("fs/promises");

// Track pending work directories for graceful shutdown
const pendingWorkDirs = new Set();

/**
 * Register a work directory for tracking (for graceful shutdown cleanup).
 *
 * @param {string} workDir - The work directory path
 */
function registerWorkDir(workDir) {
  pendingWorkDirs.add(workDir);
}

/**
 * Unregister a work directory after cleanup.
 *
 * @param {string} workDir - The work directory path
 */
function unregisterWorkDir(workDir) {
  pendingWorkDirs.delete(workDir);
}

/**
 * Clean up a work directory with proper error handling.
 *
 * @param {string} workDir - The work directory to clean up
 * @param {Object} [logger=console] - Logger instance
 * @returns {Promise<boolean>} - True if cleanup succeeded
 */
async function cleanupWorkDir(workDir, logger = console) {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
    unregisterWorkDir(workDir);
    logger.debug?.(`Cleaned up ${workDir}`);
    return true;
  } catch (error) {
    logger.error?.(`Cleanup failed for ${workDir}:`, error.message || error);
    // Still unregister to avoid duplicate cleanup attempts
    unregisterWorkDir(workDir);
    return false;
  }
}

/**
 * Clean up all pending work directories (for graceful shutdown).
 *
 * @param {Object} [logger=console] - Logger instance
 * @returns {Promise<{cleaned: number, failed: number}>}
 */
async function cleanupAllPendingWorkDirs(logger = console) {
  const dirs = Array.from(pendingWorkDirs);
  let cleaned = 0;
  let failed = 0;

  logger.info?.(`Cleaning up ${dirs.length} pending work directories...`);

  for (const dir of dirs) {
    const success = await cleanupWorkDir(dir, logger);
    if (success) {
      cleaned++;
    } else {
      failed++;
    }
  }

  logger.info?.(`Cleanup complete: ${cleaned} cleaned, ${failed} failed`);
  return { cleaned, failed };
}

/**
 * Get the number of currently tracked work directories.
 *
 * @returns {number}
 */
function getPendingWorkDirCount() {
  return pendingWorkDirs.size;
}

/**
 * Create a cleanup wrapper for async request handlers.
 * Ensures the work directory is cleaned up even if the handler throws.
 *
 * @param {string} workDir - The work directory to clean up
 * @param {Function} handler - The async handler function
 * @param {Object} [logger=console] - Logger instance
 * @returns {Promise<*>} - The result of the handler
 */
async function withCleanup(workDir, handler, logger = console) {
  registerWorkDir(workDir);
  try {
    return await handler();
  } finally {
    await cleanupWorkDir(workDir, logger);
  }
}

module.exports = {
  registerWorkDir,
  unregisterWorkDir,
  cleanupWorkDir,
  cleanupAllPendingWorkDirs,
  getPendingWorkDirCount,
  withCleanup,
};
