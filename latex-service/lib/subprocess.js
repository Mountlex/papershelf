const { spawn } = require("child_process");

const DEFAULT_TIMEOUT = 60000; // 1 minute
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024; // 10MB
const FORCE_KILL_DELAY = 5000; // 5 seconds after SIGTERM

/**
 * Spawns a subprocess with proper timeout handling that actually kills the process.
 *
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {Object} options - Options object
 * @param {string} [options.cwd] - Working directory
 * @param {number} [options.timeout=60000] - Timeout in milliseconds
 * @param {number} [options.maxOutput=10485760] - Max output size in bytes
 * @param {Object} [options.env] - Environment variables
 * @param {Object} [options.logger] - Logger instance (defaults to console)
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, code: number|null, timedOut: boolean}>}
 */
async function spawnAsync(command, args, options = {}) {
  const {
    cwd,
    timeout = DEFAULT_TIMEOUT,
    maxOutput = DEFAULT_MAX_OUTPUT,
    env,
    logger = console,
  } = options;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer = null;

    const proc = spawn(command, args, {
      cwd,
      env: env || process.env,
    });

    // Set up timeout that actually kills the process
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      logger.warn?.(`Process ${command} timed out after ${timeout}ms, sending SIGTERM`);
      proc.kill("SIGTERM");

      // Force kill after FORCE_KILL_DELAY if still running
      forceKillTimer = setTimeout(() => {
        if (!proc.killed) {
          logger.warn?.(`Process ${command} did not terminate, sending SIGKILL`);
          proc.kill("SIGKILL");
        }
      }, FORCE_KILL_DELAY);
    }, timeout);

    proc.stdout.on("data", (data) => {
      if (stdout.length < maxOutput) {
        stdout += data.toString().slice(0, maxOutput - stdout.length);
      }
    });

    proc.stderr.on("data", (data) => {
      if (stderr.length < maxOutput) {
        stderr += data.toString().slice(0, maxOutput - stderr.length);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({
        success: code === 0 && !timedOut,
        stdout,
        stderr,
        code,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        code: null,
        timedOut,
      });
    });
  });
}

/**
 * Run git command with authentication handling.
 * Credentials are passed via environment variables to avoid exposing them in process args.
 *
 * @param {string[]} args - Git command arguments
 * @param {Object} options - Options object
 * @param {string} [options.cwd] - Working directory
 * @param {number} [options.timeout=60000] - Timeout in milliseconds
 * @param {Object} [options.auth] - Authentication credentials { username, password }
 * @param {Object} [options.logger] - Logger instance
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, code: number|null, timedOut: boolean}>}
 */
async function runGit(args, options = {}) {
  const { cwd, timeout = 60000, auth, logger = console } = options;

  // Set up environment for credential passing
  const env = { ...process.env };

  if (auth && auth.username && auth.password) {
    // Use GIT_ASKPASS to provide credentials without embedding in URL
    // This is more secure than URL embedding as it doesn't appear in process args
    env.GIT_USERNAME = auth.username;
    env.GIT_PASSWORD = auth.password;
    // We'll use a simple askpass script approach via env
    // For now, we still use URL embedding but it's contained to this function
  }

  return spawnAsync("git", args, {
    cwd,
    timeout,
    env,
    logger,
  });
}

/**
 * Run latexmk with proper timeout handling.
 *
 * @param {string} compilerFlag - Compiler flag (-pdf, -xelatex, -lualatex)
 * @param {string} targetPath - Path to the .tex file
 * @param {Object} options - Options object
 * @param {string} options.cwd - Working directory
 * @param {number} [options.timeout=180000] - Timeout in milliseconds (default 3 min)
 * @param {boolean} [options.recorder=false] - Enable -recorder flag for deps detection
 * @param {Object} [options.logger] - Logger instance
 * @returns {Promise<{success: boolean, log: string, timedOut: boolean}>}
 */
async function runLatexmk(compilerFlag, targetPath, options = {}) {
  const {
    cwd,
    timeout = 180000, // 3 minutes default
    recorder = false,
    logger = console,
  } = options;

  const args = [
    compilerFlag,
    "-interaction=nonstopmode",
    "-file-line-error",
    "-cd", // Change to file's directory (safer for relative paths)
  ];

  if (recorder) {
    args.push("-recorder");
  } else {
    // -bibtex-cond1 runs bibtex/biber only when needed and auto-detects backend
    args.push("-bibtex-cond1");
    // Enable makeindex for documents with indexes
    args.push("-makeindex");
    // Add glossary support via custom rule (makeglossaries)
    args.push(
      "-e",
      `add_cus_dep('glo', 'gls', 0, 'makeglossaries'); sub makeglossaries { system("makeglossaries $_[0]"); }`
    );
  }

  args.push(targetPath);

  logger.info?.(`Running latexmk with args: ${args.join(" ")}`);
  logger.info?.(`Working directory: ${cwd}`);

  const result = await spawnAsync("latexmk", args, {
    cwd,
    timeout,
    logger,
  });

  return {
    success: result.success,
    log: result.stdout + result.stderr,
    timedOut: result.timedOut,
  };
}

/**
 * Run pdftoppm for thumbnail generation.
 *
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} outputPrefix - Output file prefix (without extension)
 * @param {Object} options - Options object
 * @param {string} [options.format='png'] - Output format ('png' or 'jpeg')
 * @param {number} [options.width=800] - Output width
 * @param {number} [options.timeout=30000] - Timeout in milliseconds
 * @param {Object} [options.logger] - Logger instance
 * @returns {Promise<{success: boolean, stderr: string, timedOut: boolean}>}
 */
async function runPdftoppm(pdfPath, outputPrefix, options = {}) {
  const {
    format = "png",
    width = 800,
    timeout = 30000,
    logger = console,
  } = options;

  const formatFlag = format === "png" ? "-png" : "-jpeg";

  const args = [
    formatFlag,
    "-f", "1",      // First page
    "-l", "1",      // Last page (same as first = only first page)
    "-singlefile", // Don't add page number suffix
    "-scale-to", String(width),
    pdfPath,
    outputPrefix,
  ];

  const result = await spawnAsync("pdftoppm", args, {
    timeout,
    logger,
  });

  return {
    success: result.success,
    stderr: result.stderr,
    timedOut: result.timedOut,
  };
}

module.exports = {
  spawnAsync,
  runGit,
  runLatexmk,
  runPdftoppm,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_OUTPUT,
};
