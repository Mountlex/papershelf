const express = require("express");
const multer = require("multer");
const compression = require("compression");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["*"];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow if origin matches allowed list or if wildcard is set
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

// Request ID tracking
app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || uuidv4();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

// Response compression (skip for binary responses like PDFs and images)
app.use(compression({
  filter: (req, res) => {
    const contentType = res.getHeader("Content-Type");
    // Skip compression for binary content types
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
  // Skip auth for health check endpoint
  if (req.path === "/health") {
    return next();
  }

  // If API key is configured, require it for all other endpoints
  if (API_KEY) {
    // Support both header and query param (fallback for mobile frameworks that strip headers)
    const providedKey = req.headers["x-api-key"] || req.query.api_key;
    if (!providedKey || providedKey !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
    }
    // Store the validated key for rate limiting
    req.apiKey = providedKey;
  }

  next();
}

// Apply API key auth middleware
app.use(apiKeyAuth);

// Configuration limits
const MAX_RESOURCES = 100;
const MAX_RESOURCE_SIZE = 10 * 1024 * 1024; // 10MB per resource
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total
const MAX_FILE_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES = 50;
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB - generous for verbose LaTeX logs
const ALLOWED_COMPILERS = ["pdflatex", "xelatex", "lualatex"];

// Simple in-memory rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per key/IP

function rateLimit(req, res, next) {
  // Use API key for rate limiting when available, otherwise fall back to IP
  // This prevents NAT issues where multiple mobile users share an IP
  const rateLimitKey = req.apiKey || req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimitMap.has(rateLimitKey)) {
    rateLimitMap.set(rateLimitKey, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", RATE_LIMIT_MAX_REQUESTS - 1);
    return next();
  }

  const record = rateLimitMap.get(rateLimitKey);

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW_MS;
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", RATE_LIMIT_MAX_REQUESTS - 1);
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader("Retry-After", retryAfterSeconds);
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));
    return res.status(429).json({
      error: "Too many requests. Please try again later.",
      retryAfter: retryAfterSeconds,
    });
  }

  record.count++;
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", RATE_LIMIT_MAX_REQUESTS - record.count);
  next();
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

// Path traversal protection - ensures the resolved path is within the work directory
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

// Async version that also checks for symlink attacks
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

// Validate target file
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

// Parse JSON bodies for the resources endpoint
app.use(express.json({ limit: "50mb" }));

// Multer for file uploads with size limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_UPLOAD_SIZE,
    files: MAX_FILES,
  },
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Dependency detection endpoint - uses latexmk to find all required files
app.post("/deps", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/latex-deps-${jobId}`;

  try {
    const { resources, target, compiler = "pdflatex" } = req.body;

    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: "Missing resources array" });
    }

    // Validate resource count
    if (resources.length > MAX_RESOURCES) {
      return res.status(400).json({ error: `Too many resources. Maximum is ${MAX_RESOURCES}` });
    }

    // Validate target
    const targetValidation = validateTarget(target);
    if (!targetValidation.valid) {
      return res.status(400).json({ error: targetValidation.error });
    }

    // Validate compiler
    if (!ALLOWED_COMPILERS.includes(compiler)) {
      return res.status(400).json({ error: `Invalid compiler. Use: ${ALLOWED_COMPILERS.join(", ")}` });
    }

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Write all resources to disk with path validation
    let totalSize = 0;
    for (const resource of resources) {
      if (!resource.path || typeof resource.path !== "string") {
        return res.status(400).json({ error: "Invalid resource: missing path" });
      }

      const filePath = safePath(workDir, resource.path);
      if (!filePath) {
        return res.status(400).json({ error: `Invalid resource path: ${resource.path}` });
      }

      const content = resource.encoding === "base64"
        ? Buffer.from(resource.content, "base64")
        : Buffer.from(resource.content || "");

      // Check individual and total size
      if (content.length > MAX_RESOURCE_SIZE) {
        return res.status(400).json({ error: `Resource too large: ${resource.path}` });
      }
      totalSize += content.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        return res.status(400).json({ error: "Total resources size exceeds limit" });
      }

      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, content);
    }

    // Run latexmk with -recorder to generate .fls file listing all dependencies
    const targetPath = path.join(workDir, target);
    const targetDir = path.dirname(targetPath);
    const targetName = path.basename(target, ".tex");

    const compilerFlag = compiler === "xelatex" ? "-xelatex"
                       : compiler === "lualatex" ? "-lualatex"
                       : "-pdf";

    // Run latexmk with -recorder (creates .fls file) and -halt-on-error
    // We use -interaction=nonstopmode so it doesn't hang on missing files
    const result = await runLatexmkForDeps(compilerFlag, targetPath, targetDir);

    // Parse the .fls file to get dependencies
    const flsPath = path.join(targetDir, `${targetName}.fls`);
    const deps = new Set();

    try {
      const flsContent = await fs.readFile(flsPath, "utf-8");
      const lines = flsContent.split("\n");

      for (const line of lines) {
        if (line.startsWith("INPUT ")) {
          const inputPath = line.substring(6).trim();
          // Only include files within our work directory (not system files)
          if (inputPath.startsWith(workDir)) {
            const relativePath = inputPath.substring(workDir.length + 1);
            // Skip auxiliary files generated by LaTeX
            if (!relativePath.match(/\.(aux|log|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml)$/)) {
              deps.add(relativePath);
            }
          }
        }
      }
    } catch (e) {
      // .fls file might not exist if compilation failed early
      // Fall back to parsing the log for missing files
    }

    // Also parse the log file for missing file errors
    const logPath = path.join(targetDir, `${targetName}.log`);
    const missingFiles = [];

    try {
      const logContent = await fs.readFile(logPath, "utf-8");

      // Look for common "file not found" patterns
      const patterns = [
        /^! LaTeX Error: File `([^']+)' not found/gm,
        /^Package biblatex Error: Style '([^']+)' not found/gm,
        /^\*\* .+ not found/gm,
        /^No file ([^\s]+)\./gm,
        /^! I can't find file `([^']+)'/gm,
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(logContent)) !== null) {
          if (match[1]) {
            missingFiles.push(match[1]);
          }
        }
      }
    } catch (e) {
      // No log file
    }

    res.json({
      success: result.success,
      dependencies: Array.from(deps),
      missingFiles: missingFiles,
      providedFiles: resources.map(r => r.path),
    });
  } catch (error) {
    console.error("Dependency detection error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Cleanup failed for ${workDir}:`, cleanupError.message || cleanupError);
    }
  }
});

function runLatexmkForDeps(compilerFlag, targetPath, workDir) {
  return new Promise((resolve) => {
    const args = [
      compilerFlag,
      "-interaction=nonstopmode",
      "-recorder",  // Creates .fls file with all file accesses
      "-halt-on-error",
      targetPath,
    ];

    const proc = spawn("latexmk", args, {
      cwd: workDir,
      timeout: 60000, // 1 minute timeout for dependency detection
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString().slice(0, MAX_OUTPUT_SIZE - stdout.length);
      }
    });

    proc.stderr.on("data", (data) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString().slice(0, MAX_OUTPUT_SIZE - stderr.length);
      }
    });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        log: stdout + stderr,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        log: err.message,
      });
    });
  });
}

// Compile endpoint - accepts JSON with resources array
app.post("/compile", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/latex-${jobId}`;

  try {
    const { resources, target, compiler = "pdflatex" } = req.body;

    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: "Missing resources array" });
    }

    // Validate resource count
    if (resources.length > MAX_RESOURCES) {
      return res.status(400).json({ error: `Too many resources. Maximum is ${MAX_RESOURCES}` });
    }

    // Validate target
    const targetValidation = validateTarget(target);
    if (!targetValidation.valid) {
      return res.status(400).json({ error: targetValidation.error });
    }

    // Validate compiler
    if (!ALLOWED_COMPILERS.includes(compiler)) {
      return res.status(400).json({ error: `Invalid compiler. Use: ${ALLOWED_COMPILERS.join(", ")}` });
    }

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Write all resources to disk with path validation
    let totalSize = 0;
    for (const resource of resources) {
      if (!resource.path || typeof resource.path !== "string") {
        return res.status(400).json({ error: "Invalid resource: missing path" });
      }

      const filePath = safePath(workDir, resource.path);
      if (!filePath) {
        return res.status(400).json({ error: `Invalid resource path: ${resource.path}` });
      }

      // Handle different encodings
      let content;
      if (resource.encoding === "base64") {
        content = Buffer.from(resource.content, "base64");
      } else if (resource.encoding === "bytes") {
        content = Buffer.from(resource.content);
      } else {
        content = Buffer.from(resource.content || "");
      }

      // Check individual and total size
      if (content.length > MAX_RESOURCE_SIZE) {
        return res.status(400).json({ error: `Resource too large: ${resource.path}` });
      }
      totalSize += content.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        return res.status(400).json({ error: "Total resources size exceeds limit" });
      }

      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, content);
    }

    // Use latexmk for automatic compilation (handles bibtex, multiple passes, etc.)
    const targetPath = path.join(workDir, target);
    const targetDir = path.dirname(targetPath);
    const targetName = path.basename(target, ".tex");

    let lastError = "";

    // Run latexmk with the appropriate compiler
    const compilerFlag = compiler === "xelatex" ? "-xelatex"
                       : compiler === "lualatex" ? "-lualatex"
                       : "-pdf";

    const result = await runLatexmk(compilerFlag, targetPath, targetDir);
    if (!result.success) {
      lastError = result.log;
    }

    // Check if PDF was created
    const pdfPath = path.join(targetDir, `${targetName}.pdf`);

    try {
      await fs.access(pdfPath);
    } catch {
      // Try to get log file for error details
      const logPath = path.join(targetDir, `${targetName}.log`);
      let logContent = lastError;
      try {
        logContent = await fs.readFile(logPath, "utf-8");
      } catch {
        // No log file
      }

      return res.status(400).json({
        error: "Compilation failed",
        log: logContent,  // Return full log
      });
    }

    // Read and return PDF
    const pdfBuffer = await fs.readFile(pdfPath);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Compilation error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Cleanup failed for ${workDir}:`, cleanupError.message || cleanupError);
    }
  }
});

// Compile endpoint with file uploads (multipart form)
app.post("/compile/upload", rateLimit, upload.array("files"), async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/latex-${jobId}`;

  try {
    const { target, compiler = "pdflatex" } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Validate target
    const targetValidation = validateTarget(target);
    if (!targetValidation.valid) {
      return res.status(400).json({ error: targetValidation.error });
    }

    // Validate compiler
    if (!ALLOWED_COMPILERS.includes(compiler)) {
      return res.status(400).json({ error: `Invalid compiler. Use: ${ALLOWED_COMPILERS.join(", ")}` });
    }

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Write uploaded files with path validation
    for (const file of files) {
      const filePath = safePath(workDir, file.originalname);
      if (!filePath) {
        return res.status(400).json({ error: `Invalid file path: ${file.originalname}` });
      }
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, file.buffer);
    }

    // Use latexmk for automatic compilation (handles bibtex, multiple passes, etc.)
    const targetPath = path.join(workDir, target);
    const targetDir = path.dirname(targetPath);
    const targetName = path.basename(target, ".tex");

    const compilerFlag = compiler === "xelatex" ? "-xelatex"
                       : compiler === "lualatex" ? "-lualatex"
                       : "-pdf";

    const result = await runLatexmk(compilerFlag, targetPath, targetDir);

    // Check if PDF was created
    const pdfPath = path.join(targetDir, `${targetName}.pdf`);

    try {
      await fs.access(pdfPath);
    } catch {
      const logPath = path.join(targetDir, `${targetName}.log`);
      let logContent = result.log || "";
      try {
        logContent = await fs.readFile(logPath, "utf-8");
      } catch {
        // No log file
      }

      return res.status(400).json({
        error: "Compilation failed",
        log: logContent,
      });
    }

    const pdfBuffer = await fs.readFile(pdfPath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Compilation error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
});

function runLatexmk(compilerFlag, targetPath, workDir) {
  return new Promise((resolve) => {
    const args = [
      compilerFlag,
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-bibtex",  // Enable bibtex/biber processing
      targetPath,
    ];
    console.log(`Running latexmk with args: ${args.join(" ")}`);
    console.log(`Working directory: ${workDir}`);

    const proc = spawn(
      "latexmk",
      args,
      {
        cwd: workDir,
        timeout: 180000, // 3 minute timeout for complex documents
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString().slice(0, MAX_OUTPUT_SIZE - stdout.length);
      }
    });

    proc.stderr.on("data", (data) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString().slice(0, MAX_OUTPUT_SIZE - stderr.length);
      }
    });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        log: stdout + stderr,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        log: err.message,
      });
    });
  });
}

// ==========================================
// Git endpoints for Overleaf and authenticated Git operations
// ==========================================

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

// POST /git/refs - Get commit refs using git ls-remote
app.post("/git/refs", rateLimit, async (req, res) => {
  try {
    const { gitUrl, branch, auth } = req.body;

    if (!gitUrl) {
      return res.status(400).json({ error: "Missing gitUrl" });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    // Run git ls-remote to get refs
    const result = await new Promise((resolve) => {
      const proc = spawn("git", ["ls-remote", authenticatedUrl], {
        timeout: 30000,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          stdout += data.toString().slice(0, MAX_OUTPUT_SIZE - stdout.length);
        }
      });

      proc.stderr.on("data", (data) => {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          stderr += data.toString().slice(0, MAX_OUTPUT_SIZE - stderr.length);
        }
      });

      proc.on("close", (code) => {
        resolve({ success: code === 0, stdout, stderr });
      });

      proc.on("error", (err) => {
        resolve({ success: false, stdout: "", stderr: err.message });
      });
    });

    if (!result.success) {
      return res.status(400).json({ error: result.stderr || "Failed to access repository" });
    }

    // Parse refs to find HEAD, default branch, and requested branch
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

    res.json({
      sha: requestedSha || headSha,
      defaultBranch,
      message: "Latest commit",
      date: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Git refs error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /git/tree - List files by cloning and reading directory
app.post("/git/tree", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-tree-${jobId}`;

  try {
    const { gitUrl, path: requestedPath, branch, auth } = req.body;

    if (!gitUrl) {
      return res.status(400).json({ error: "Missing gitUrl" });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Clone with depth 1 for efficiency
    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await new Promise((resolve) => {
      const proc = spawn("git", cloneArgs, { timeout: 60000 });

      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ success: code === 0, stderr });
      });

      proc.on("error", (err) => {
        resolve({ success: false, stderr: err.message });
      });
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    // List files in the requested path (with path traversal protection)
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
        // Skip .git directory
        if (entry.name === ".git") continue;

        const filePath = requestedPath ? `${requestedPath}/${entry.name}` : entry.name;
        files.push({
          name: entry.name,
          path: filePath,
          type: entry.isDirectory() ? "dir" : "file",
        });
      }
    } catch (e) {
      return res.status(404).json({ error: `Path not found: ${requestedPath}` });
    }

    res.json({ files });
  } catch (error) {
    console.error("Git tree error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Cleanup failed for ${workDir}:`, cleanupError.message || cleanupError);
    }
  }
});

// POST /git/file - Fetch single file content
app.post("/git/file", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-file-${jobId}`;

  try {
    const { gitUrl, filePath, branch, auth } = req.body;

    if (!gitUrl || !filePath) {
      return res.status(400).json({ error: "Missing gitUrl or filePath" });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Clone with depth 1
    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await new Promise((resolve) => {
      const proc = spawn("git", cloneArgs, { timeout: 60000 });

      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ success: code === 0, stderr });
      });

      proc.on("error", (err) => {
        resolve({ success: false, stderr: err.message });
      });
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    // Read the requested file (with path traversal protection)
    const targetPath = await safePathAsync(workDir, filePath);
    if (!targetPath) {
      return res.status(400).json({ error: "Invalid file path" });
    }

    try {
      const content = await fs.readFile(targetPath);

      // Check if binary
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
    } catch (e) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }
  } catch (error) {
    console.error("Git file error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Cleanup failed for ${workDir}:`, cleanupError.message || cleanupError);
    }
  }
});

// POST /git/archive - Fetch all project files as JSON array
app.post("/git/archive", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/git-archive-${jobId}`;

  try {
    const { gitUrl, branch, auth } = req.body;

    if (!gitUrl) {
      return res.status(400).json({ error: "Missing gitUrl" });
    }

    const authenticatedUrl = buildAuthenticatedUrl(gitUrl, auth);

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Clone with depth 1
    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(authenticatedUrl, workDir);

    const cloneResult = await new Promise((resolve) => {
      const proc = spawn("git", cloneArgs, { timeout: 120000 });

      let stderr = "";
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ success: code === 0, stderr });
      });

      proc.on("error", (err) => {
        resolve({ success: false, stderr: err.message });
      });
    });

    if (!cloneResult.success) {
      return res.status(400).json({ error: cloneResult.stderr || "Failed to clone repository" });
    }

    // Recursively read all files
    const files = [];
    const binaryExtensions = new Set([
      ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif",
      ".eps", ".ps", ".svg", ".ico", ".webp", ".zip", ".tar", ".gz",
    ]);

    async function readDir(dirPath, relativePath = "") {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip .git directory
        if (entry.name === ".git") continue;

        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await readDir(fullPath, relPath);
        } else {
          try {
            const content = await fs.readFile(fullPath);
            const ext = path.extname(entry.name).toLowerCase();

            // Skip very large files (> 10MB)
            if (content.length > 10 * 1024 * 1024) {
              console.log(`Skipping large file: ${relPath} (${content.length} bytes)`);
              continue;
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
            console.error(`Error reading file ${relPath}:`, e);
          }
        }
      }
    }

    await readDir(workDir);

    res.json({ files });
  } catch (error) {
    console.error("Git archive error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Cleanup failed for ${workDir}:`, cleanupError.message || cleanupError);
    }
  }
});

// POST /thumbnail - Generate thumbnail from PDF first page
app.post("/thumbnail", rateLimit, async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/thumbnail-${jobId}`;

  try {
    const { pdfBase64, width = 400, format = "png" } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: "Missing pdfBase64" });
    }

    // Validate format
    if (!["png", "jpeg"].includes(format)) {
      return res.status(400).json({ error: "Invalid format. Use: png, jpeg" });
    }

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Decode and write PDF
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    const pdfPath = path.join(workDir, "input.pdf");
    await fs.writeFile(pdfPath, pdfBuffer);

    // Generate thumbnail using pdftoppm
    // -f 1 -l 1: only first page
    // -singlefile: don't add page number suffix
    // -scale-to: scale to width while maintaining aspect ratio
    const outputPrefix = path.join(workDir, "thumb");
    const formatFlag = format === "png" ? "-png" : "-jpeg";

    const result = await new Promise((resolve) => {
      const args = [
        formatFlag,
        "-f", "1",
        "-l", "1",
        "-singlefile",
        "-scale-to", String(width),
        pdfPath,
        outputPrefix,
      ];

      const proc = spawn("pdftoppm", args, {
        timeout: 30000, // 30 second timeout
      });

      let stderr = "";

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ success: code === 0, stderr });
      });

      proc.on("error", (err) => {
        resolve({ success: false, stderr: err.message });
      });
    });

    if (!result.success) {
      return res.status(400).json({ error: `Thumbnail generation failed: ${result.stderr}` });
    }

    // Read the generated thumbnail
    const ext = format === "png" ? "png" : "jpg";
    const thumbPath = path.join(workDir, `thumb.${ext}`);

    try {
      const thumbBuffer = await fs.readFile(thumbPath);
      const contentType = format === "png" ? "image/png" : "image/jpeg";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", thumbBuffer.length);
      res.send(thumbBuffer);
    } catch (e) {
      return res.status(500).json({ error: "Failed to read generated thumbnail" });
    }
  } catch (error) {
    console.error("Thumbnail generation error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Cleanup failed for ${workDir}:`, cleanupError.message || cleanupError);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LaTeX compilation service running on port ${PORT}`);
});
