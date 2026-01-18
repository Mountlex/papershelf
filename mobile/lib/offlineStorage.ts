import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system";

// Storage directories
export const PDF_DIR = `${FileSystem.documentDirectory}pdfs/`;
export const THUMB_DIR = `${FileSystem.documentDirectory}thumbnails/`;

// Database instance
let db: SQLite.SQLiteDatabase | null = null;

export interface OfflinePaper {
  paperId: string;
  localPath: string;
  thumbnailPath: string | null;
  fileSize: number;
  cachedCommitHash: string | null;
  isPinned: boolean;
  savedAt: number;
  lastViewedAt: number | null;
  title: string;
  authors: string | null;
}

export interface DownloadQueueItem {
  paperId: string;
  status: "pending" | "downloading" | "completed" | "error";
  progress: number;
  error: string | null;
  addedAt: number;
}

/**
 * Initialize the database and create tables
 */
export async function initDatabase(): Promise<void> {
  if (db) return;

  db = await SQLite.openDatabaseAsync("carrel.db");

  // Create tables
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_papers (
      paper_id TEXT PRIMARY KEY,
      local_path TEXT NOT NULL,
      thumbnail_path TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      cached_commit_hash TEXT,
      is_pinned INTEGER DEFAULT 1,
      saved_at INTEGER NOT NULL,
      last_viewed_at INTEGER,
      title TEXT NOT NULL DEFAULT '',
      authors TEXT
    );

    CREATE TABLE IF NOT EXISTS download_queue (
      paper_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      progress REAL DEFAULT 0,
      error TEXT,
      added_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_offline_papers_saved_at ON offline_papers(saved_at);
    CREATE INDEX IF NOT EXISTS idx_download_queue_status ON download_queue(status);
  `);

  // Ensure storage directories exist
  await FileSystem.makeDirectoryAsync(PDF_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true }).catch(() => {});
}

/**
 * Get database instance (initializes if needed)
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    await initDatabase();
  }
  return db!;
}

// ============ Offline Papers ============

/**
 * Get all offline papers
 */
export async function getOfflinePapers(): Promise<OfflinePaper[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    paper_id: string;
    local_path: string;
    thumbnail_path: string | null;
    file_size: number;
    cached_commit_hash: string | null;
    is_pinned: number;
    saved_at: number;
    last_viewed_at: number | null;
    title: string;
    authors: string | null;
  }>("SELECT * FROM offline_papers ORDER BY saved_at DESC");

  return rows.map((row) => ({
    paperId: row.paper_id,
    localPath: row.local_path,
    thumbnailPath: row.thumbnail_path,
    fileSize: row.file_size,
    cachedCommitHash: row.cached_commit_hash,
    isPinned: row.is_pinned === 1,
    savedAt: row.saved_at,
    lastViewedAt: row.last_viewed_at,
    title: row.title,
    authors: row.authors,
  }));
}

/**
 * Check if a paper is available offline
 */
export async function isOffline(paperId: string): Promise<boolean> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM offline_papers WHERE paper_id = ?",
    [paperId]
  );
  return (result?.count ?? 0) > 0;
}

/**
 * Get a specific offline paper
 */
export async function getOfflinePaper(paperId: string): Promise<OfflinePaper | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{
    paper_id: string;
    local_path: string;
    thumbnail_path: string | null;
    file_size: number;
    cached_commit_hash: string | null;
    is_pinned: number;
    saved_at: number;
    last_viewed_at: number | null;
    title: string;
    authors: string | null;
  }>("SELECT * FROM offline_papers WHERE paper_id = ?", [paperId]);

  if (!row) return null;

  return {
    paperId: row.paper_id,
    localPath: row.local_path,
    thumbnailPath: row.thumbnail_path,
    fileSize: row.file_size,
    cachedCommitHash: row.cached_commit_hash,
    isPinned: row.is_pinned === 1,
    savedAt: row.saved_at,
    lastViewedAt: row.last_viewed_at,
    title: row.title,
    authors: row.authors,
  };
}

/**
 * Get the cached PDF path for a paper
 */
export async function getCachedPdfPath(paperId: string): Promise<string | null> {
  const paper = await getOfflinePaper(paperId);
  if (!paper) return null;

  // Verify file still exists
  const info = await FileSystem.getInfoAsync(paper.localPath);
  if (!info.exists) {
    // File was deleted externally, clean up database
    await removeOfflinePaper(paperId);
    return null;
  }

  // Update last viewed time
  const database = await getDb();
  await database.runAsync(
    "UPDATE offline_papers SET last_viewed_at = ? WHERE paper_id = ?",
    [Date.now(), paperId]
  );

  return paper.localPath;
}

/**
 * Save a paper to offline storage
 */
export async function saveOfflinePaper(paper: {
  paperId: string;
  localPath: string;
  thumbnailPath?: string | null;
  fileSize: number;
  cachedCommitHash?: string | null;
  title: string;
  authors?: string[];
}): Promise<void> {
  const database = await getDb();

  await database.runAsync(
    `INSERT OR REPLACE INTO offline_papers
     (paper_id, local_path, thumbnail_path, file_size, cached_commit_hash, is_pinned, saved_at, title, authors)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      paper.paperId,
      paper.localPath,
      paper.thumbnailPath ?? null,
      paper.fileSize,
      paper.cachedCommitHash ?? null,
      Date.now(),
      paper.title,
      paper.authors?.join(", ") ?? null,
    ]
  );
}

/**
 * Remove a paper from offline storage
 */
export async function removeOfflinePaper(paperId: string): Promise<void> {
  const database = await getDb();

  // Get file paths first
  const paper = await getOfflinePaper(paperId);

  // Delete from database
  await database.runAsync("DELETE FROM offline_papers WHERE paper_id = ?", [paperId]);

  // Delete files
  if (paper) {
    await FileSystem.deleteAsync(paper.localPath, { idempotent: true }).catch(() => {});
    if (paper.thumbnailPath) {
      await FileSystem.deleteAsync(paper.thumbnailPath, { idempotent: true }).catch(() => {});
    }
  }
}

/**
 * Get total storage used by offline papers
 */
export async function getTotalStorageUsed(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ total: number }>(
    "SELECT COALESCE(SUM(file_size), 0) as total FROM offline_papers"
  );
  return result?.total ?? 0;
}

/**
 * Get count of offline papers
 */
export async function getOfflinePaperCount(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM offline_papers"
  );
  return result?.count ?? 0;
}

/**
 * Clear all offline data
 */
export async function clearAllOfflineData(): Promise<void> {
  const database = await getDb();

  // Delete all records
  await database.runAsync("DELETE FROM offline_papers");
  await database.runAsync("DELETE FROM download_queue");

  // Delete all files
  await FileSystem.deleteAsync(PDF_DIR, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(THUMB_DIR, { idempotent: true }).catch(() => {});

  // Recreate directories
  await FileSystem.makeDirectoryAsync(PDF_DIR, { intermediates: true });
  await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true });
}

// ============ Download Queue ============

/**
 * Add a paper to the download queue
 */
export async function addToDownloadQueue(paperId: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR REPLACE INTO download_queue (paper_id, status, progress, added_at)
     VALUES (?, 'pending', 0, ?)`,
    [paperId, Date.now()]
  );
}

/**
 * Update download queue item status
 */
export async function updateDownloadStatus(
  paperId: string,
  status: DownloadQueueItem["status"],
  progress?: number,
  error?: string
): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE download_queue SET status = ?, progress = ?, error = ? WHERE paper_id = ?`,
    [status, progress ?? 0, error ?? null, paperId]
  );
}

/**
 * Remove from download queue
 */
export async function removeFromDownloadQueue(paperId: string): Promise<void> {
  const database = await getDb();
  await database.runAsync("DELETE FROM download_queue WHERE paper_id = ?", [paperId]);
}

/**
 * Get all items in download queue
 */
export async function getDownloadQueue(): Promise<DownloadQueueItem[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    paper_id: string;
    status: string;
    progress: number;
    error: string | null;
    added_at: number;
  }>("SELECT * FROM download_queue ORDER BY added_at ASC");

  return rows.map((row) => ({
    paperId: row.paper_id,
    status: row.status as DownloadQueueItem["status"],
    progress: row.progress,
    error: row.error,
    addedAt: row.added_at,
  }));
}

/**
 * Get pending downloads count
 */
export async function getPendingDownloadsCount(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM download_queue WHERE status IN ('pending', 'downloading')"
  );
  return result?.count ?? 0;
}

/**
 * Clear completed and errored downloads from queue
 */
export async function clearCompletedDownloads(): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "DELETE FROM download_queue WHERE status IN ('completed', 'error')"
  );
}
