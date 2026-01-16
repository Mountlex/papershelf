const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3001;

// Parse JSON bodies for the resources endpoint
app.use(express.json({ limit: "50mb" }));

// Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Compile endpoint - accepts JSON with resources array
app.post("/compile", async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/latex-${jobId}`;

  try {
    const { resources, target, compiler = "pdflatex" } = req.body;

    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: "Missing resources array" });
    }

    if (!target) {
      return res.status(400).json({ error: "Missing target file" });
    }

    // Validate compiler
    const allowedCompilers = ["pdflatex", "xelatex", "lualatex"];
    if (!allowedCompilers.includes(compiler)) {
      return res.status(400).json({ error: `Invalid compiler. Use: ${allowedCompilers.join(", ")}` });
    }

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Write all resources to disk
    for (const resource of resources) {
      const filePath = path.join(workDir, resource.path);
      const fileDir = path.dirname(filePath);

      // Create subdirectories if needed
      await fs.mkdir(fileDir, { recursive: true });

      // Handle different encodings
      if (resource.encoding === "base64") {
        await fs.writeFile(filePath, Buffer.from(resource.content, "base64"));
      } else if (resource.encoding === "bytes") {
        // Content is an array of byte values
        await fs.writeFile(filePath, Buffer.from(resource.content));
      } else {
        await fs.writeFile(filePath, resource.content);
      }
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
        log: logContent.slice(-2000), // Last 2000 chars of log
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
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Compile endpoint with file uploads (multipart form)
app.post("/compile/upload", upload.array("files"), async (req, res) => {
  const jobId = uuidv4();
  const workDir = `/tmp/latex-${jobId}`;

  try {
    const { target, compiler = "pdflatex" } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (!target) {
      return res.status(400).json({ error: "Missing target file" });
    }

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Write uploaded files
    for (const file of files) {
      const filePath = path.join(workDir, file.originalname);
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, file.buffer);
    }

    // Run compiler
    const targetPath = path.join(workDir, target);
    const targetDir = path.dirname(targetPath);
    const targetName = path.basename(target, ".tex");

    for (let i = 0; i < 3; i++) {
      await runCompiler(compiler, targetPath, targetDir);
    }

    // Check if PDF was created
    const pdfPath = path.join(targetDir, `${targetName}.pdf`);

    try {
      await fs.access(pdfPath);
    } catch {
      const logPath = path.join(targetDir, `${targetName}.log`);
      let logContent = "";
      try {
        logContent = await fs.readFile(logPath, "utf-8");
      } catch {
        // No log file
      }

      return res.status(400).json({
        error: "Compilation failed",
        log: logContent.slice(-2000),
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
    const proc = spawn(
      "latexmk",
      [
        compilerFlag,
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        targetPath,
      ],
      {
        cwd: workDir,
        timeout: 180000, // 3 minute timeout for complex documents
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
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

function runCompiler(compiler, targetPath, workDir) {
  return new Promise((resolve) => {
    const proc = spawn(
      compiler,
      [
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        targetPath,
      ],
      {
        cwd: workDir,
        timeout: 120000, // 120 second timeout
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
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

function runBibtex(targetName, workDir) {
  return new Promise((resolve) => {
    const proc = spawn("bibtex", [targetName], {
      cwd: workDir,
      timeout: 60000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
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

app.listen(PORT, () => {
  console.log(`LaTeX compilation service running on port ${PORT}`);
});
