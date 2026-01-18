import { useState, useEffect } from "react";
import { downloadManager, QueueStatus } from "@/lib/downloadManager";
import { isOffline as checkIsOffline } from "@/lib/offlineStorage";

interface DownloadStatus {
  isOffline: boolean;
  isDownloading: boolean;
  progress: number;
}

/**
 * Hook to get download status for a specific paper
 */
export function useDownloadStatus(paperId: string): DownloadStatus {
  const [isOffline, setIsOffline] = useState(false);
  const [isDownloading, setIsDownloading] = useState(
    () => downloadManager.isDownloading(paperId)
  );
  const [progress, setProgress] = useState(
    () => downloadManager.getProgress(paperId)
  );

  useEffect(() => {
    // Check initial offline status
    checkIsOffline(paperId).then(setIsOffline);

    // Listen for progress updates
    const handleProgress = (data: { paperId: string; progress: number }) => {
      if (data.paperId === paperId) {
        setProgress(data.progress);
        setIsDownloading(true);
      }
    };

    const handleStarted = (startedPaperId: string) => {
      if (startedPaperId === paperId) {
        setIsDownloading(true);
        setProgress(0);
      }
    };

    const handleCompleted = (completedPaperId: string) => {
      if (completedPaperId === paperId) {
        setIsDownloading(false);
        setIsOffline(true);
        setProgress(1);
      }
    };

    const handleError = (data: { paperId: string }) => {
      if (data.paperId === paperId) {
        setIsDownloading(false);
        setProgress(0);
      }
    };

    const handleQueueUpdated = () => {
      setIsDownloading(downloadManager.isDownloading(paperId));
      setProgress(downloadManager.getProgress(paperId));
    };

    downloadManager.on("progress", handleProgress);
    downloadManager.on("downloadStarted", handleStarted);
    downloadManager.on("downloadCompleted", handleCompleted);
    downloadManager.on("downloadError", handleError);
    downloadManager.on("queueUpdated", handleQueueUpdated);

    return () => {
      downloadManager.off("progress", handleProgress);
      downloadManager.off("downloadStarted", handleStarted);
      downloadManager.off("downloadCompleted", handleCompleted);
      downloadManager.off("downloadError", handleError);
      downloadManager.off("queueUpdated", handleQueueUpdated);
    };
  }, [paperId]);

  return { isOffline, isDownloading, progress };
}

/**
 * Hook to get overall download queue status
 */
export function useDownloadQueue(): QueueStatus {
  const [status, setStatus] = useState<QueueStatus>(downloadManager.getQueueStatus());

  useEffect(() => {
    const handleUpdate = (newStatus: QueueStatus) => {
      setStatus(newStatus);
    };

    downloadManager.on("queueUpdated", handleUpdate);

    return () => {
      downloadManager.off("queueUpdated", handleUpdate);
    };
  }, []);

  return status;
}
