const express = require("express");
const compression = require("compression");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Import utilities
const { logger, createRequestLogger } = require("./lib/logger");
const { spawnAsync, runLatexmk, runLatexmkWithProgress, runPdftoppm, runGit } = require("./lib/subprocess");
const { withCleanup, cleanupAllPendingWorkDirs } = require("./lib/cleanup");
const { rateLimit } = require("./lib/rateLimit");
const { compilationQueue } = require("./lib/queue");
const {
  LIMITS,
  safePathAsync,
  validateTarget,
  validateCompiler,
  validateThumbnailOptions,
  validateGitUrl,
  validateFilePath,
} = require("./lib/validation");

const app = express();
const PORT = process.env.PORT || 3001;

// Request tracking for graceful shutdown
let activeRequests = 0;
let shuttingDown = false;

// Middleware to track active requests and reject new requests during shutdown
function requestTracker(req, res, next) {
  if (shuttingDown && req.path !== "/health") {
    return res.status(503).json({ error: "Server is shutting down" });
  }
  activeRequests++;
  res.on("finish", () => {
    activeRequests--;
  });
  res.on("close", () => {
    // Handle aborted requests
    if (!res.writableEnded) {
      activeRequests--;
    }
  });
  next();
}

app.use(requestTracker);

// CORS configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["*"];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Request ID tracking and logging
app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || uuidv4();
  req.requestId = requestId;
  req.log = createRequestLogger(requestId, req.path);
  res.setHeader("X-Request-Id", requestId);
  next();
});

// Response compression (skip for binary responses like PDFs and images)
app.use(compression({
  filter: (req, res) => {
    const contentType = res.getHeader("Content-Type");
    if (contentType && (
      contentType.includes("application/pdf") ||
      contentType.includes("image/")
    )) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// API Key authentication
const API_KEY = process.env.LATEX_SERVICE_API_KEY;

function apiKeyAuth(req, res, next) {
  if (req.path === "/health") {
    return next();
  }

  if (API_KEY) {
    // Prefer header, but allow query param with deprecation warning
    let providedKey = req.headers["x-api-key"];
    if (!providedKey && req.query.api_key) {
      req.log.warn("API key in query params is deprecated, use X-API-Key header instead");
      providedKey = req.query.api_key;
    }
    if (!providedKey || providedKey !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
    }
    req.apiKey = providedKey;
  }

  next();
}

app.use(apiKeyAuth);

// Parse JSON bodies
app.use(express.json({ limit: "50mb" }));

// Helper to check if a command is available
async function checkCommand(command, args = ["--version"]) {
  try {
    const result = await spawnAsync(command, args, { timeout: 5000 });
    return { ok: result.success, version: result.stdout.trim().split("\n")[0] };
  } catch {
    return { ok: false, version: null };
  }
}

// Health check with dependency verification
app.get("/health", async (req, res) => {
  const checks = {
    latexmk: await checkCommand("latexmk", ["--version"]),
    git: await checkCommand("git", ["--version"]),
    pdftoppm: await checkCommand("pdftoppm", ["-v"]),
  };

  const healthy = Object.values(checks).every(c => c.ok);
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks,
    queue: compilationQueue.stats(),
  });
});

// Helper to build authenticated git URL
function buildAuthenticatedUrl(gitUrl, auth) {
  if (!auth || !auth.username || !auth.password) {
    return gitUrl;
  }
  const url = new URL(gitUrl);
  url.username = encodeURIComponent(auth.username);
  url.password = encodeURIComponent(auth.password);
  return url.toString();
}

// Compile from git - clone repo and compile directly
app.post("/compile-from-git", rateLimit, async (req, res) => {
  try {
    await compilationQueue.run(async () => {
      const jobId = uuidv4();
      const workDir = `/tmp/latex-git-${jobId}`;

      await withCleanup(workDir, async () => {
        const { gitUrl, branch, target, auth, compiler = "pdflatex", progressCallback } = req.body;

        // Helper to send progress callbacks (fire-and-forget, don't block on errors)
        const sendProgress = async (message) => {
          if (progressCallback && progressCallback.url && progressCallback.paperId) {
            try {
              const resp = await fetch(progressCallback.url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Compile-Secret": progressCallback.secret || "",
                },
                body: JSON.stringify({
                  paperId: progressCallback.paperId,
                  progress: message,
                }),
              });
              if (!resp.ok) {
                req.log.warn(`Progress callback failed: ${resp.status} ${resp.statusText}`);
              }
            } catch (err) {
              req.log.warn({ err }, "Failed to send progress callback");
            }
          }
        };

        const gitUrlValidation = validateGitUrl(gitUrl);
        if (!gitUrlValidation.valid) {
          return res.status(400).json({ error: gitUrlValidation.error });
        }

        const targetValidation = validateTarget(target);
        if (!targetValidation.valid) {
          return res.status(400).json({ error: targetValidation.error });
        }

        const compilerValidation = validateCompiler(compiler);
        if (!compilerValidation.valid) {
          return res.status(400).json({ error: compilerValidation.error });
        }

        const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

        await fs.mkdir(workDir, { recursive: true });

        // Clone repository
        await sendProgress("Cloning repository...");
        req.log.info("Cloning repository...");
        const cloneArgs = ["clone", "--depth", "1"];
        if (branch) {
          cloneArgs.push("--branch", branch);
        }
        cloneArgs.push(authenticatedUrl, workDir);

        const cloneResult = await spawnAsync("git", cloneArgs, {
          timeout: 180000,
          logger: req.log,
        });

        if (!cloneResult.success) {
          return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
        }

        // Run latexmk with -recorder to track dependencies
        const targetPath = path.join(workDir, target);
        const targetDir = path.dirname(targetPath);
        const targetName = path.basename(target, ".tex");

        // Check if target file exists
        try {
          await fs.access(targetPath);
        } catch {
          return res.status(404).json({ error: `Target file not found: ${target}` });
        }

        const compilerFlag = compiler === "xelatex" ? "-xelatex"
                           : compiler === "lualatex" ? "-lualatex"
                           : "-pdf";

        await sendProgress("Starting compilation...");
        req.log.info(`Compiling ${target} with ${compiler}...`);

        // Use progress-enabled latexmk if callback is configured
        const result = progressCallback
          ? await runLatexmkWithProgress(compilerFlag, targetPath, {
              cwd: targetDir,
              timeout: 300000,
              recorder: true,
              logger: req.log,
              onProgress: sendProgress,
            })
          : await runLatexmk(compilerFlag, targetPath, {
              cwd: targetDir,
              timeout: 300000,
              recorder: true,
              logger: req.log,
            });

        // Check if PDF was created
        const pdfPath = path.join(targetDir, `${targetName}.pdf`);

        try {
          await fs.access(pdfPath);
        } catch {
          const logPath = path.join(targetDir, `${targetName}.log`);
          let logContent = result.log;
          try {
            logContent = await fs.readFile(logPath, "utf-8");
          } catch {
            // No log file
          }

          return res.status(400).json({
            error: "Compilation failed",
            log: logContent,
            timedOut: result.timedOut,
          });
        }

        // Compilation succeeded
        await sendProgress("Finalizing...");

        // Parse .fls file for dependencies
        const flsPath = path.join(targetDir, `${targetName}.fls`);
        const deps = new Set();
        try {
          const flsContent = await fs.readFile(flsPath, "utf-8");
          const lines = flsContent.split("\n");

          let flsPwd = workDir;
          for (const line of lines) {
            if (line.startsWith("PWD ")) {
              flsPwd = line.substring(4).trim();
              break;
            }
          }

          for (const line of lines) {
            if (line.startsWith("INPUT ")) {
              const inputPath = line.substring(6).trim();
              let relativePath = null;
              if (inputPath.startsWith(flsPwd + "/")) {
                relativePath = inputPath.substring(flsPwd.length + 1);
              } else if (inputPath.startsWith(workDir + "/")) {
                relativePath = inputPath.substring(workDir.length + 1);
              } else if (inputPath.startsWith("./")) {
                relativePath = inputPath.substring(2);
              } else if (!inputPath.startsWith("/")) {
                relativePath = inputPath;
              }

              if (relativePath && !relativePath.match(/\.(aux|log|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml)$/)) {
                // Check if file exists in repo (not a system file)
                const fullPath = path.join(workDir, relativePath);
                try {
                  await fs.access(fullPath);
                  deps.add(relativePath);
                } catch {
                  // File doesn't exist in repo, skip
                }
              }
            }
          }
        } catch {
          // .fls file might not exist
        }

        // Check for .bib files used
        const auxPath = path.join(targetDir, `${targetName}.aux`);
        try {
          const auxContent = await fs.readFile(auxPath, "utf-8");
          const bibdataMatches = auxContent.matchAll(/\\bibdata\{([^}]+)\}/g);
          for (const match of bibdataMatches) {
            const bibFiles = match[1].split(",").map(f => f.trim());
            for (const bibFile of bibFiles) {
              const bibWithExt = bibFile.endsWith(".bib") ? bibFile : `${bibFile}.bib`;
              const fullPath = path.join(workDir, bibWithExt);
              try {
                await fs.access(fullPath);
                deps.add(bibWithExt);
              } catch {
                // Try in target directory
                const altPath = path.join(targetDir, bibWithExt);
                try {
                  await fs.access(altPath);
                  const relPath = path.relative(workDir, altPath);
                  deps.add(relPath);
                } catch {
                  // File not found
                }
              }
            }
          }
        } catch {
          // No aux file
        }

        // Also check .bcf file for biblatex
        const bcfPath = path.join(targetDir, `${targetName}.bcf`);
        try {
          const bcfContent = await fs.readFile(bcfPath, "utf-8");
          const datasourcePattern = /<bcf:datasource[^>]*>([^<]+)<\/bcf:datasource>/g;
          let dsMatch;
          while ((dsMatch = datasourcePattern.exec(bcfContent)) !== null) {
            if (dsMatch[1]) {
              const bibFile = dsMatch[1];
              const bibWithExt = bibFile.endsWith(".bib") ? bibFile : `${bibFile}.bib`;
              const fullPath = path.join(workDir, bibWithExt);
              try {
                await fs.access(fullPath);
                deps.add(bibWithExt);
              } catch {
                // Try in target directory
                const altPath = path.join(targetDir, bibWithExt);
                try {
                  await fs.access(altPath);
                  const relPath = path.relative(workDir, altPath);
                  deps.add(relPath);
                } catch {
                  // File not found
                }
              }
            }
          }
        } catch {
          // No bcf file
        }

        // Read and return PDF with dependencies in header
        const pdfBuffer = await fs.readFile(pdfPath);
        req.log.info(`Compilation successful, PDF size: ${pdfBuffer.length} bytes`);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", pdfBuffer.length);
        if (deps.size > 0) {
          res.setHeader("X-Dependencies", JSON.stringify(Array.from(deps)));
        }
        res.send(pdfBuffer);
      }, req.log);
    }, { logger: req.log });
  } catch (err) {
    if (err.code === "QUEUE_FULL") {
      return res.status(503).json({
        error: "Server is busy. Please try again later.",
        queue: err.stats,
        retryAfter: 30,
      });
    }
    throw err;
  }
});

// Git refs endpoint
app.post("/git/refs", rateLimit, async (req, res) => {
  const { gitUrl, branch, auth, knownSha } = req.body;

  const gitUrlValidation = validateGitUrl(gitUrl);
  if (!gitUrlValidation.valid) {
    return res.status(400).json({ error: gitUrlValidation.error });
  }

  const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

  const result = await spawnAsync("git", ["ls-remote", authenticatedUrl], {
    timeout: 30000,
    logger: req.log,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.stderr || "Failed to access repository" });
  }

  // Parse refs
  const lines = result.stdout.trim().split("\n");
  let headSha = null;
  let defaultBranch = "master";
  let requestedSha = null;

  for (const line of lines) {
    const [sha, ref] = line.split("\t");
    if (ref === "HEAD") {
      headSha = sha;
    } else if (ref === "refs/heads/master" || ref === "refs/heads/main") {
      if (!requestedSha && (!branch || branch === "master" || branch === "main")) {
        requestedSha = sha;
        defaultBranch = ref.replace("refs/heads/", "");
      }
    }
    if (branch && ref === `refs/heads/${branch}`) {
      requestedSha = sha;
    }
  }

  const sha = requestedSha || headSha;

  // If SHA hasn't changed, skip the expensive commit date fetch
  // The client already has the date from the previous sync
  if (knownSha && sha === knownSha) {
    return res.json({
      sha,
      defaultBranch,
      unchanged: true,
    });
  }

  // SHA changed or no knownSha provided - fetch commit details
  const jobId = uuidv4();
  const workDir = `/tmp/git-refs-${jobId}`;

  await withCleanup(workDir, async () => {
    let commitDate = null;
    let commitMessage = "Latest commit";
    let authorName = null;
    let authorEmail = null;

    if (sha) {
      try {
        await fs.mkdir(workDir, { recursive: true });

        // Initialize bare repo and fetch just the commit we need
        await spawnAsync("git", ["init", "--bare"], { cwd: workDir, logger: req.log });

        const targetBranch = branch || defaultBranch;
        const fetchResult = await spawnAsync(
          "git",
          ["fetch", "--depth=1", authenticatedUrl, `refs/heads/${targetBranch}:refs/heads/${targetBranch}`],
          { cwd: workDir, timeout: 30000, logger: req.log }
        );

        if (fetchResult.success) {
          // Get commit date, message, and author
          // Format: date, author name, author email, subject
          const logResult = await spawnAsync(
            "git",
            ["log", "-1", "--format=%cI%n%an%n%ae%n%s", sha],
            { cwd: workDir, logger: req.log }
          );

          if (logResult.success && logResult.stdout.trim()) {
            const lines = logResult.stdout.trim().split("\n");
            commitDate = lines[0];
            authorName = lines[1] || null;
            authorEmail = lines[2] || null;
            commitMessage = lines.slice(3).join("\n") || "Latest commit";
          }
        }
      } catch (err) {
        req.log.warn({ err }, "Failed to fetch commit date, using current time");
      }
    }

    res.json({
      sha,
      defaultBranch,
      message: commitMessage,
      date: commitDate || new Date().toISOString(),
      authorName,
      authorEmail,
    });
  }, req.log);
});

// Git tree endpoint
app.post("/git/tree", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-tree-${jobId}`;

  await withCleanup(workDir, async () => {
    const { gitUrl, path: requestedPath, branch, auth } = req.body;

    const gitUrlValidation = validateGitUrl(gitUrl);
    if (!gitUrlValidation.valid) {
      return res.status(400).json({ error: gitUrlValidation.error });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    await fs.mkdir(workDir, { recursive: true });

    // Clone with depth 1
    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await spawnAsync("git", cloneArgs, {
      timeout: 60000,
      logger: req.log,
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    // List files with path traversal protection
    let targetDir = workDir;
    if (requestedPath) {
      targetDir = await safePathAsync(workDir, requestedPath);
      if (!targetDir) {
        return res.status(400).json({ error: "Invalid path" });
      }
    }

    const files = [];
    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === ".git") continue;

        const filePath = requestedPath ? `${requestedPath}/${entry.name}` : entry.name;
        files.push({
          name: entry.name,
          path: filePath,
          type: entry.isDirectory() ? "dir" : "file",
        });
      }
    } catch {
      return res.status(404).json({ error: `Path not found: ${requestedPath}` });
    }

    res.json({ files });
  }, req.log);
});

// Git file endpoint
app.post("/git/file", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-file-${jobId}`;

  await withCleanup(workDir, async () => {
    const { gitUrl, filePath, branch, auth } = req.body;

    const gitUrlValidation = validateGitUrl(gitUrl);
    if (!gitUrlValidation.valid) {
      return res.status(400).json({ error: gitUrlValidation.error });
    }

    const filePathValidation = validateFilePath(filePath);
    if (!filePathValidation.valid) {
      return res.status(400).json({ error: filePathValidation.error });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    await fs.mkdir(workDir, { recursive: true });

    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await spawnAsync("git", cloneArgs, {
      timeout: 60000,
      logger: req.log,
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    const targetPath = await safePathAsync(workDir, filePath);
    if (!targetPath) {
      return res.status(400).json({ error: "Invalid file path" });
    }

    try {
      const content = await fs.readFile(targetPath);
      const ext = path.extname(filePath).toLowerCase();
      const binaryExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".eps", ".svg"];

      if (binaryExtensions.includes(ext)) {
        res.json({
          content: content.toString("base64"),
          encoding: "base64",
        });
      } else {
        res.json({
          content: content.toString("utf-8"),
          encoding: "utf-8",
        });
      }
    } catch {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }
  }, req.log);
});

// Git archive endpoint
app.post("/git/archive", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-archive-${jobId}`;

  await withCleanup(workDir, async () => {
    const { gitUrl, branch, auth } = req.body;

    const gitUrlValidation = validateGitUrl(gitUrl);
    if (!gitUrlValidation.valid) {
      return res.status(400).json({ error: gitUrlValidation.error });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    await fs.mkdir(workDir, { recursive: true });

    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await spawnAsync("git", cloneArgs, {
      timeout: 180000,
      logger: req.log,
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    // Recursively read all files with depth limit and size/count tracking
    const files = [];
    const binaryExtensions = new Set([
      ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif",
      ".eps", ".ps", ".svg", ".ico", ".webp", ".zip", ".tar", ".gz",
    ]);
    const MAX_DEPTH = 20; // Prevent stack overflow on deeply nested repos

    // Track totals for repository limits
    let totalSize = 0;
    let fileCount = 0;
    let limitExceeded = null; // Will hold error info if limits exceeded

    async function readDir(dirPath, relativePath = "", depth = 0) {
      if (limitExceeded) return; // Stop if limits already exceeded

      if (depth > MAX_DEPTH) {
        req.log.warn(`Max directory depth (${MAX_DEPTH}) exceeded at ${relativePath}`);
        return;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (limitExceeded) return; // Stop if limits exceeded
        if (entry.name === ".git") continue;

        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await readDir(fullPath, relPath, depth + 1);
        } else {
          try {
            const content = await fs.readFile(fullPath);
            const ext = path.extname(entry.name).toLowerCase();

            // Skip very large files
            if (content.length > LIMITS.MAX_RESOURCE_SIZE) {
              req.log.info(`Skipping large file: ${relPath} (${content.length} bytes)`);
              continue;
            }

            // Check repository size limit
            totalSize += content.length;
            if (totalSize > LIMITS.MAX_REPO_SIZE) {
              limitExceeded = {
                error: "Repository content too large",
                totalSize,
                limit: LIMITS.MAX_REPO_SIZE,
              };
              return;
            }

            // Check repository file count limit
            fileCount++;
            if (fileCount > LIMITS.MAX_REPO_FILES) {
              limitExceeded = {
                error: "Too many files in repository",
                fileCount,
                limit: LIMITS.MAX_REPO_FILES,
              };
              return;
            }

            if (binaryExtensions.has(ext)) {
              files.push({
                path: relPath,
                content: content.toString("base64"),
                encoding: "base64",
              });
            } else {
              files.push({
                path: relPath,
                content: content.toString("utf-8"),
              });
            }
          } catch (e) {
            req.log.error({ err: e }, `Error reading file ${relPath}`);
          }
        }
      }
    }

    await readDir(workDir);

    // Return 413 if limits were exceeded
    if (limitExceeded) {
      return res.status(413).json(limitExceeded);
    }

    res.json({ files });
  }, req.log);
});

// Git selective archive endpoint - fetches only files matching extensions or specific paths
app.post("/git/selective-archive", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-selective-${jobId}`;

  await withCleanup(workDir, async () => {
    const { gitUrl, branch, auth, extensions, paths } = req.body;

    const gitUrlValidation = validateGitUrl(gitUrl);
    if (!gitUrlValidation.valid) {
      return res.status(400).json({ error: gitUrlValidation.error });
    }

    // Must provide either extensions or paths
    if ((!extensions || extensions.length === 0) && (!paths || paths.length === 0)) {
      return res.status(400).json({ error: "Must provide either 'extensions' or 'paths' array" });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    await fs.mkdir(workDir, { recursive: true });

    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await spawnAsync("git", cloneArgs, {
      timeout: 180000,
      logger: req.log,
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    const files = [];
    const binaryExtensions = new Set([
      ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif",
      ".eps", ".ps", ".svg", ".ico", ".webp", ".zip", ".tar", ".gz",
    ]);
    const MAX_DEPTH = 20;

    // Track totals for repository limits
    let totalSize = 0;
    let fileCount = 0;
    let limitExceeded = null; // Will hold error info if limits exceeded

    // Normalize extensions to lowercase with leading dot
    const normalizedExtensions = extensions
      ? new Set(extensions.map(ext => ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
      : null;

    // Normalize paths for lookup
    const normalizedPaths = paths
      ? new Set(paths.map(p => p.replace(/^\//, ""))) // Remove leading slash if present
      : null;

    async function readDir(dirPath, relativePath = "", depth = 0) {
      if (limitExceeded) return; // Stop if limits already exceeded

      if (depth > MAX_DEPTH) {
        req.log.warn(`Max directory depth (${MAX_DEPTH}) exceeded at ${relativePath}`);
        return;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (limitExceeded) return; // Stop if limits exceeded
        if (entry.name === ".git") continue;

        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await readDir(fullPath, relPath, depth + 1);
        } else {
          const ext = path.extname(entry.name).toLowerCase();

          // Check if file matches our filter criteria
          const matchesExtension = normalizedExtensions && normalizedExtensions.has(ext);
          const matchesPath = normalizedPaths && normalizedPaths.has(relPath);

          if (!matchesExtension && !matchesPath) {
            continue; // Skip files that don't match
          }

          try {
            const content = await fs.readFile(fullPath);

            // Skip very large files
            if (content.length > LIMITS.MAX_RESOURCE_SIZE) {
              req.log.info(`Skipping large file: ${relPath} (${content.length} bytes)`);
              continue;
            }

            // Check repository size limit
            totalSize += content.length;
            if (totalSize > LIMITS.MAX_REPO_SIZE) {
              limitExceeded = {
                error: "Repository content too large",
                totalSize,
                limit: LIMITS.MAX_REPO_SIZE,
              };
              return;
            }

            // Check repository file count limit
            fileCount++;
            if (fileCount > LIMITS.MAX_REPO_FILES) {
              limitExceeded = {
                error: "Too many files in repository",
                fileCount,
                limit: LIMITS.MAX_REPO_FILES,
              };
              return;
            }

            if (binaryExtensions.has(ext)) {
              files.push({
                path: relPath,
                content: content.toString("base64"),
                encoding: "base64",
              });
            } else {
              files.push({
                path: relPath,
                content: content.toString("utf-8"),
              });
            }
          } catch (e) {
            req.log.error({ err: e }, `Error reading file ${relPath}`);
          }
        }
      }
    }

    await readDir(workDir);

    // Return 413 if limits were exceeded
    if (limitExceeded) {
      return res.status(413).json(limitExceeded);
    }

    // Report which requested paths were not found (useful for debugging)
    const foundPaths = new Set(files.map(f => f.path));
    const missingPaths = normalizedPaths
      ? Array.from(normalizedPaths).filter(p => !foundPaths.has(p))
      : [];

    res.json({ files, missingPaths });
  }, req.log);
});

// Git file-hash endpoint
app.post("/git/file-hash", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-hash-${jobId}`;

  await withCleanup(workDir, async () => {
    const { gitUrl, filePath, filePaths, branch, auth } = req.body;

    // Determine if batch request
    const isBatch = Array.isArray(filePaths) && filePaths.length > 0;
    const pathsToProcess = isBatch ? filePaths : (filePath ? [filePath] : []);

    const gitUrlValidation = validateGitUrl(gitUrl);
    if (!gitUrlValidation.valid) {
      return res.status(400).json({ error: gitUrlValidation.error });
    }

    if (pathsToProcess.length === 0) {
      return res.status(400).json({ error: "Missing filePath or filePaths" });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    await fs.mkdir(workDir, { recursive: true });

    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await spawnAsync("git", cloneArgs, {
      timeout: 60000,
      logger: req.log,
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    // Process all file paths
    const hashes = {};
    for (const fp of pathsToProcess) {
      const targetPath = await safePathAsync(workDir, fp);
      if (!targetPath) {
        hashes[fp] = null;
        continue;
      }

      try {
        await fs.access(targetPath);
      } catch {
        hashes[fp] = null;
        continue;
      }

      const hashResult = await spawnAsync("git", ["hash-object", fp], {
        cwd: workDir,
        timeout: 10000,
        logger: req.log,
      });

      hashes[fp] = hashResult.success ? hashResult.stdout.trim() : null;
    }

    if (isBatch) {
      res.json({ hashes });
    } else {
      const hash = hashes[filePath];
      if (hash === null) {
        return res.status(404).json({ error: `File not found or invalid: ${filePath}` });
      }
      res.json({ hash });
    }
  }, req.log);
});

// Thumbnail endpoint
app.post("/thumbnail", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/thumbnail-${jobId}`;

  await withCleanup(workDir, async () => {
    const { pdfBase64, width = 800, format = "png" } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: "Missing pdfBase64" });
    }

    const optionsValidation = validateThumbnailOptions({ width, format });
    if (!optionsValidation.valid) {
      return res.status(400).json({ error: optionsValidation.error });
    }

    await fs.mkdir(workDir, { recursive: true });

    // Decode and write PDF
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    const pdfPath = path.join(workDir, "input.pdf");
    await fs.writeFile(pdfPath, pdfBuffer);

    const outputPrefix = path.join(workDir, "thumb");

    const result = await runPdftoppm(pdfPath, outputPrefix, {
      format,
      width,
      timeout: 30000,
      logger: req.log,
    });

    if (!result.success) {
      return res.status(400).json({
        error: `Thumbnail generation failed: ${result.stderr}`,
        timedOut: result.timedOut,
      });
    }

    const ext = format === "png" ? "png" : "jpg";
    const thumbPath = path.join(workDir, `thumb.${ext}`);

    try {
      const thumbBuffer = await fs.readFile(thumbPath);
      const contentType = format === "png" ? "image/png" : "image/jpeg";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", thumbBuffer.length);
      res.send(thumbBuffer);
    } catch {
      return res.status(500).json({ error: "Failed to read generated thumbnail" });
    }
  }, req.log);
});

// Start server with proper configuration
const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(`LaTeX compilation service running on port ${PORT}`);
});

// Set server-level timeouts
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 65000; // Slightly higher than common load balancer timeouts
server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout

// Helper to wait for active requests to drain
function waitForRequestsDrain(maxWaitMs = 25000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (activeRequests === 0) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > maxWaitMs) {
        logger.warn(`${activeRequests} requests still active after ${maxWaitMs}ms, proceeding with cleanup`);
        clearInterval(checkInterval);
        resolve(false);
      } else {
        logger.info(`Waiting for ${activeRequests} active request(s) to complete...`);
      }
    }, 1000);
  });
}

// Graceful shutdown handling
async function shutdown(signal) {
  if (shuttingDown) {
    logger.warn(`Received ${signal} during shutdown, forcing exit`);
    process.exit(1);
  }

  shuttingDown = true;
  logger.info(`${signal} received, starting graceful shutdown...`);
  logger.info(`Active requests: ${activeRequests}`);
  logger.info(`Compilation queue: ${JSON.stringify(compilationQueue.stats())}`);

  // Clear queued (not yet started) compilations - they'll get 503 errors
  compilationQueue.clear();

  // Stop accepting new connections
  server.close(async () => {
    logger.info("HTTP server closed, no new connections accepted");

    // Wait for active requests to complete
    if (activeRequests > 0) {
      logger.info(`Waiting for ${activeRequests} active request(s) to drain...`);
      await waitForRequestsDrain();
    }

    // Clean up pending work directories (should be empty if all requests completed)
    await cleanupAllPendingWorkDirs(logger);

    logger.info("Shutdown complete");
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
