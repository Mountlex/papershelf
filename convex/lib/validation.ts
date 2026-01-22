// Common weak passwords to reject
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "qwerty", "qwerty123",
  "letmein", "welcome", "admin", "login", "abc123", "123456",
  "12345678", "123456789", "1234567890", "iloveyou", "monkey",
  "dragon", "master", "sunshine", "princess", "football", "baseball",
  "soccer", "hockey", "batman", "superman", "trustno1", "shadow",
]);

/**
 * Validates a password against the security requirements.
 * Throws an error if validation fails.
 * @param password - The password to validate
 * @param email - Optional email to check password doesn't contain it
 * @throws Error if password doesn't meet requirements
 */
export function validatePasswordOrThrow(password: string, email?: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (password.length > 128) {
    throw new Error("Password must be 128 characters or less");
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    throw new Error("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    throw new Error("Password must contain at least one number");
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    throw new Error("Password must contain at least one special character");
  }
  // Check against common passwords (case-insensitive, ignoring numbers/special chars)
  const passwordBase = password.toLowerCase().replace(/[^a-z]/g, "");
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || COMMON_PASSWORDS.has(passwordBase)) {
    throw new Error("Password is too common. Please choose a more unique password");
  }
  // Check if password contains email username
  if (email) {
    const emailUsername = email.split("@")[0].toLowerCase();
    if (emailUsername.length >= 3 && password.toLowerCase().includes(emailUsername)) {
      throw new Error("Password cannot contain your email address");
    }
  }
}

/**
 * Validates a file path for tracked files.
 * Prevents path traversal attacks and normalizes the path.
 * @param filePath - The file path to validate
 * @returns Object with valid flag and normalized path or error message
 */
// Paper field validation limits
export const PAPER_VALIDATION_LIMITS = {
  title: { maxLength: 500 },
  abstract: { maxLength: 10000 },
  authors: { maxCount: 50, maxNameLength: 200 },
};

// Repository name validation limits
export const REPOSITORY_VALIDATION_LIMITS = {
  name: { maxLength: 255 },
};

/**
 * Validates a paper title.
 * @param title - The title to validate
 * @throws Error if title exceeds maximum length
 */
export function validateTitleOrThrow(title: string): void {
  if (title.length > PAPER_VALIDATION_LIMITS.title.maxLength) {
    throw new Error(`Title must be ${PAPER_VALIDATION_LIMITS.title.maxLength} characters or less`);
  }
}

/**
 * Validates a paper abstract.
 * @param abstract - The abstract to validate
 * @throws Error if abstract exceeds maximum length
 */
export function validateAbstractOrThrow(abstract: string): void {
  if (abstract.length > PAPER_VALIDATION_LIMITS.abstract.maxLength) {
    throw new Error(`Abstract must be ${PAPER_VALIDATION_LIMITS.abstract.maxLength.toLocaleString()} characters or less`);
  }
}

/**
 * Validates paper authors array.
 * @param authors - The authors array to validate
 * @throws Error if authors count or name length exceeds limits
 */
export function validateAuthorsOrThrow(authors: string[]): void {
  if (authors.length > PAPER_VALIDATION_LIMITS.authors.maxCount) {
    throw new Error(`Maximum ${PAPER_VALIDATION_LIMITS.authors.maxCount} authors allowed`);
  }
  for (const author of authors) {
    if (author.length > PAPER_VALIDATION_LIMITS.authors.maxNameLength) {
      throw new Error(`Author names must be ${PAPER_VALIDATION_LIMITS.authors.maxNameLength} characters or less`);
    }
  }
}

/**
 * Validates multiple paper fields at once.
 * @param fields - Object containing optional title, abstract, and authors
 * @throws Error if any field fails validation
 */
export function validatePaperFieldsOrThrow(fields: {
  title?: string;
  abstract?: string;
  authors?: string[];
}): void {
  if (fields.title !== undefined) {
    validateTitleOrThrow(fields.title);
  }
  if (fields.abstract !== undefined) {
    validateAbstractOrThrow(fields.abstract);
  }
  if (fields.authors !== undefined) {
    validateAuthorsOrThrow(fields.authors);
  }
}

/**
 * Validates a repository name.
 * @param name - The repository name to validate
 * @throws Error if name exceeds maximum length
 */
export function validateRepositoryNameOrThrow(name: string): void {
  if (name.length > REPOSITORY_VALIDATION_LIMITS.name.maxLength) {
    throw new Error(`Repository name must be ${REPOSITORY_VALIDATION_LIMITS.name.maxLength} characters or less`);
  }
}

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
