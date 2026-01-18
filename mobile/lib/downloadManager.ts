import * as FileSystem from "expo-file-system";
import { EventEmitter } from "events";
import {
  PDF_DIR,
  THUMB_DIR,
  saveOfflinePaper,
  addToDownloadQueue,
  updateDownloadStatus,
  removeFromDownloadQueue,
  getDownloadQueue,
  isOffline,
} from "./offlineStorage";

export interface Paper {
  _id: string;
  title: string;
  authors?: string[];
  pdfUrl?: string;
  thumbnailUrl?: string;
  cachedCommitHash?: string;
}

interface DownloadTask {
  paperId: string;
  paper: Paper;
  status: "pending" | "downloading" | "completed" | "error";
  progress: number;
  error?: string;
  downloadResumable?: FileSystem.DownloadResumable;
}

export interface QueueStatus {
  pending: number;
  downloading: number;
  completed: number;
  error: number;
  total: number;
  currentPaperId?: string;
  currentProgress?: number;
}

type DownloadEventType =
  | "queueUpdated"
  | "downloadStarted"
  | "progress"
  | "downloadCompleted"
  | "downloadError";

class DownloadManager extends EventEmitter {
  private queue: Map<string, DownloadTask> = new Map();
  private activeDownloads = 0;
  private maxConcurrent = 2;
  private isProcessing = false;

  /**
   * Download a single paper
   */
  async downloadPaper(paper: Paper): Promise<void> {
    // Skip if already downloaded or in queue
    if (await isOffline(paper._id)) {
      return;
    }

    if (this.queue.has(paper._id)) {
      return;
    }

    if (!paper.pdfUrl) {
      console.warn(`Paper ${paper._id} has no PDF URL`);
      return;
    }

    const task: DownloadTask = {
      paperId: paper._id,
      paper,
      status: "pending",
      progress: 0,
    };

    this.queue.set(paper._id, task);
    await addToDownloadQueue(paper._id);

    this.emit("queueUpdated", this.getQueueStatus());
    this.processQueue();
  }

  /**
   * Download all papers
   */
  async downloadAll(papers: Paper[]): Promise<void> {
    for (const paper of papers) {
      await this.downloadPaper(paper);
    }
  }

  /**
   * Cancel a specific download
   */
  cancelDownload(paperId: string): void {
    const task = this.queue.get(paperId);

    if (task) {
      // Cancel active download if in progress
      if (task.downloadResumable) {
        task.downloadResumable.pauseAsync().catch(() => {});
      }

      this.queue.delete(paperId);
      removeFromDownloadQueue(paperId);

      if (task.status === "downloading") {
        this.activeDownloads--;
      }

      this.emit("queueUpdated", this.getQueueStatus());
      this.processQueue();
    }
  }

  /**
   * Cancel all downloads
   */
  cancelAll(): void {
    for (const [paperId, task] of this.queue) {
      if (task.downloadResumable) {
        task.downloadResumable.pauseAsync().catch(() => {});
      }
      removeFromDownloadQueue(paperId);
    }

    this.queue.clear();
    this.activeDownloads = 0;
    this.emit("queueUpdated", this.getQueueStatus());
  }

  /**
   * Process the download queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (this.activeDownloads >= this.maxConcurrent) return;

    const pending = Array.from(this.queue.values()).find(
      (t) => t.status === "pending"
    );

    if (!pending) return;

    this.isProcessing = true;
    this.activeDownloads++;
    pending.status = "downloading";

    await updateDownloadStatus(pending.paperId, "downloading");
    this.emit("downloadStarted", pending.paperId);
    this.emit("queueUpdated", this.getQueueStatus());

    try {
      await this.performDownload(pending);
    } finally {
      this.isProcessing = false;
      this.processQueue(); // Process next item
    }
  }

  /**
   * Perform the actual download
   */
  private async performDownload(task: DownloadTask): Promise<void> {
    const { paper } = task;
    const pdfPath = `${PDF_DIR}${paper._id}.pdf`;
    const thumbPath = `${THUMB_DIR}${paper._id}.jpg`;

    try {
      // Ensure directories exist
      await FileSystem.makeDirectoryAsync(PDF_DIR, { intermediates: true }).catch(
        () => {}
      );
      await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true }).catch(
        () => {}
      );

      // Download PDF with progress tracking
      const downloadResumable = FileSystem.createDownloadResumable(
        paper.pdfUrl!,
        pdfPath,
        {},
        (downloadProgress) => {
          const progress =
            downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite;

          task.progress = progress;
          updateDownloadStatus(task.paperId, "downloading", progress);

          this.emit("progress", {
            paperId: task.paperId,
            progress,
            bytesWritten: downloadProgress.totalBytesWritten,
            totalBytes: downloadProgress.totalBytesExpectedToWrite,
          });
          this.emit("queueUpdated", this.getQueueStatus());
        }
      );

      task.downloadResumable = downloadResumable;

      const result = await downloadResumable.downloadAsync();

      if (!result) {
        throw new Error("Download was cancelled");
      }

      // Download thumbnail if available
      let thumbnailPath: string | null = null;
      if (paper.thumbnailUrl) {
        try {
          await FileSystem.downloadAsync(paper.thumbnailUrl, thumbPath);
          thumbnailPath = thumbPath;
        } catch (thumbError) {
          // Thumbnail download failed, continue without it
          console.warn("Thumbnail download failed:", thumbError);
        }
      }

      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(pdfPath);

      // Save to offline storage database
      await saveOfflinePaper({
        paperId: paper._id,
        localPath: pdfPath,
        thumbnailPath,
        fileSize: (fileInfo as { size?: number }).size ?? 0,
        cachedCommitHash: paper.cachedCommitHash,
        title: paper.title,
        authors: paper.authors,
      });

      // Update task status
      task.status = "completed";
      task.progress = 1;
      await updateDownloadStatus(task.paperId, "completed", 1);
      await removeFromDownloadQueue(task.paperId);

      this.emit("downloadCompleted", task.paperId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Download failed";

      task.status = "error";
      task.error = errorMessage;
      await updateDownloadStatus(task.paperId, "error", 0, errorMessage);

      this.emit("downloadError", {
        paperId: task.paperId,
        error: errorMessage,
      });

      // Clean up partial files
      await FileSystem.deleteAsync(pdfPath, { idempotent: true }).catch(() => {});
      await FileSystem.deleteAsync(thumbPath, { idempotent: true }).catch(() => {});
    } finally {
      this.activeDownloads--;
      this.queue.delete(task.paperId);
      this.emit("queueUpdated", this.getQueueStatus());
    }
  }

  /**
   * Resume downloads from persistent queue (after app restart)
   */
  async resumeDownloads(papers: Paper[]): Promise<void> {
    const queue = await getDownloadQueue();
    const pendingItems = queue.filter(
      (item) => item.status === "pending" || item.status === "downloading"
    );

    for (const item of pendingItems) {
      const paper = papers.find((p) => p._id === item.paperId);
      if (paper) {
        // Reset to pending and add to queue
        await updateDownloadStatus(item.paperId, "pending");
        const task: DownloadTask = {
          paperId: item.paperId,
          paper,
          status: "pending",
          progress: 0,
        };
        this.queue.set(item.paperId, task);
      } else {
        // Paper no longer exists, remove from queue
        await removeFromDownloadQueue(item.paperId);
      }
    }

    if (this.queue.size > 0) {
      this.emit("queueUpdated", this.getQueueStatus());
      this.processQueue();
    }
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): QueueStatus {
    const tasks = Array.from(this.queue.values());
    const downloading = tasks.find((t) => t.status === "downloading");

    return {
      pending: tasks.filter((t) => t.status === "pending").length,
      downloading: tasks.filter((t) => t.status === "downloading").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      error: tasks.filter((t) => t.status === "error").length,
      total: tasks.length,
      currentPaperId: downloading?.paperId,
      currentProgress: downloading?.progress,
    };
  }

  /**
   * Check if a paper is being downloaded
   */
  isDownloading(paperId: string): boolean {
    const task = this.queue.get(paperId);
    return task?.status === "downloading" || task?.status === "pending";
  }

  /**
   * Get download progress for a specific paper
   */
  getProgress(paperId: string): number {
    return this.queue.get(paperId)?.progress ?? 0;
  }

  // Event listener type overrides
  on(event: DownloadEventType, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  off(event: DownloadEventType, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }
}

// Singleton instance
export const downloadManager = new DownloadManager();
