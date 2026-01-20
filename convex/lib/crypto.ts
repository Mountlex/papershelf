/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Security characteristics:
 * - Uses 12-byte (96-bit) IV as recommended for GCM
 * - Authentication tag is automatically included by GCM mode
 * - Unique IV per encryption via crypto.getRandomValues()
 * - Key derived from hex-encoded 32-byte secret
 *
 * Format: base64(iv):base64(ciphertext+authTag)
 *
 * If TOKEN_ENCRYPTION_KEY is not set, tokens are stored unencrypted.
 * This allows gradual migration and development without breaking auth.
 */

const ENCRYPTION_KEY_ENV = "TOKEN_ENCRYPTION_KEY";

// Cache the imported key to avoid re-importing on every operation
let cachedKey: CryptoKey | null = null;
let keyCheckDone = false;
let keyAvailable = false;

/**
 * Check if encryption is available (key is configured).
 */
export function isEncryptionAvailable(): boolean {
  if (!keyCheckDone) {
    const keyHex = process.env[ENCRYPTION_KEY_ENV];
    keyAvailable = !!(keyHex && keyHex.length === 64);
    keyCheckDone = true;
    if (!keyAvailable && keyHex) {
      console.warn(`${ENCRYPTION_KEY_ENV} is set but invalid (must be 64 hex chars). Tokens will NOT be encrypted.`);
    }
  }
  return keyAvailable;
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey;
  }

  const keyHex = process.env[ENCRYPTION_KEY_ENV];
  if (!keyHex) {
    throw new Error(`${ENCRYPTION_KEY_ENV} environment variable not set`);
  }
  if (keyHex.length !== 64) {
    throw new Error(`${ENCRYPTION_KEY_ENV} must be 64 hex characters (32 bytes)`);
  }

  // Parse hex string to bytes
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  }

  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );

  return cachedKey;
}

// Base64 encode helper (works in Convex runtime)
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// Base64 decode helper
function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * Returns format: base64(iv):base64(ciphertext+authTag)
 */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();

  // Generate a random 12-byte IV (96 bits, recommended for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encode plaintext to bytes
  const encoder = new TextEncoder();
  const encoded = encoder.encode(plaintext);

  // Encrypt (GCM automatically appends the auth tag to ciphertext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  // Convert to base64 for storage
  const ivB64 = toBase64(iv);
  const ctB64 = toBase64(new Uint8Array(ciphertext));

  return `${ivB64}:${ctB64}`;
}

/**
 * Decrypt an encrypted token.
 * Expects format: base64(iv):base64(ciphertext+authTag)
 */
export async function decryptToken(encrypted: string): Promise<string> {
  const [ivB64, ctB64] = encrypted.split(":");
  if (!ivB64 || !ctB64) {
    throw new Error("Invalid encrypted token format");
  }

  // Decode from base64
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(ctB64);

  const key = await getEncryptionKey();

  // Decrypt (GCM automatically verifies the auth tag)
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  // Decode bytes to string
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Check if a value appears to be encrypted (has the iv:ciphertext format).
 * 12-byte IV = 16 base64 characters (no padding needed for 12 bytes).
 * This is a heuristic check, not a guarantee.
 */
export function isEncrypted(value: string | undefined | null): boolean {
  if (!value) return false;
  const parts = value.split(":");
  // Check for two parts where the first is base64-encoded 12 bytes
  // Base64 of 12 bytes = 16 chars (no padding needed for 12 bytes)
  return parts.length === 2 && parts[0].length === 16;
}

/**
 * Encrypt a token if it's not already encrypted.
 * Returns the encrypted token, or the original value if:
 * - Already encrypted
 * - Encryption key is not configured (graceful degradation)
 */
export async function encryptTokenIfNeeded(value: string | undefined | null): Promise<string | undefined> {
  if (!value) return undefined;
  if (isEncrypted(value)) return value;
  // If encryption key is not configured, return unencrypted (graceful degradation)
  if (!isEncryptionAvailable()) return value;
  return encryptToken(value);
}

/**
 * Decrypt a token if it's encrypted, otherwise return as-is.
 * Useful for migration period where some tokens may not yet be encrypted.
 */
export async function decryptTokenIfNeeded(value: string | undefined | null): Promise<string | null> {
  if (!value) return null;
  if (!isEncrypted(value)) return value;
  return decryptToken(value);
}
