/**
 * Validates a password against the security requirements.
 * Throws an error if validation fails.
 * @param password - The password to validate
 * @throws Error if password doesn't meet requirements
 */
export function validatePasswordOrThrow(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error("Password must contain at least one uppercase letter");
  }
  if (!/[0-9]/.test(password)) {
    throw new Error("Password must contain at least one number");
  }
}

/**
 * Validates a file path for tracked files.
 * Prevents path traversal attacks and normalizes the path.
 * @param filePath - The file path to validate
 * @returns Object with valid flag and normalized path or error message
 */
export function validateFilePath(filePath: string):
  | { valid: true; normalized: string }
  | { valid: false; error: string } {
  // Reject empty paths
  if (!filePath || filePath.trim() === "") {
    return { valid: false, error: "File path cannot be empty" };
  }

  // Normalize to forward slashes
  let normalized = filePath.replace(/\\/g, "/");

  // Reject absolute paths (Unix-style / or Windows-style C:\)
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(filePath)) {
    return { valid: false, error: "Absolute paths are not allowed" };
  }

  // Reject paths with directory traversal
  // Check for .. segments (including at start, middle, or end)
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      return { valid: false, error: "Path traversal (..) is not allowed" };
    }
  }

  // Remove redundant slashes and ./ segments
  normalized = segments
    .filter((seg) => seg !== "" && seg !== ".")
    .join("/");

  // Reject if path becomes empty after normalization
  if (normalized === "") {
    return { valid: false, error: "File path cannot be empty" };
  }

  return { valid: true, normalized };
}

/**
 * Validates a pattern string (for artifactPattern or releasePattern).
 * Prevents path traversal attacks in patterns.
 * @param pattern - The pattern string to validate
 * @returns Object with valid flag or error message
 */
export function validatePattern(pattern: string):
  | { valid: true }
  | { valid: false; error: string } {
  // Empty/undefined patterns are valid (optional field)
  if (!pattern || pattern.trim() === "") {
    return { valid: true };
  }

  // Reject absolute paths
  if (pattern.startsWith("/") || /^[a-zA-Z]:/.test(pattern)) {
    return { valid: false, error: "Absolute paths are not allowed in patterns" };
  }

  // Reject patterns with directory traversal
  const normalized = pattern.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      return { valid: false, error: "Path traversal (..) is not allowed in patterns" };
    }
  }

  return { valid: true };
}
