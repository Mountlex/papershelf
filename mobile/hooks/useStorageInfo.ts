import { useState, useEffect, useCallback } from "react";
import {
  getTotalStorageUsed,
  getOfflinePaperCount,
  initDatabase,
} from "@/lib/offlineStorage";
import { downloadManager } from "@/lib/downloadManager";

interface StorageInfo {
  totalSize: number;
  paperCount: number;
  isLoading: boolean;
}

/**
 * Hook to get storage usage information
 */
export function useStorageInfo(): StorageInfo {
  const [totalSize, setTotalSize] = useState(0);
  const [paperCount, setPaperCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const loadStorageInfo = useCallback(async () => {
    try {
      await initDatabase();
      const [size, count] = await Promise.all([
        getTotalStorageUsed(),
        getOfflinePaperCount(),
      ]);
      setTotalSize(size);
      setPaperCount(count);
    } catch (error) {
      console.error("Error loading storage info:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStorageInfo();

    // Refresh when downloads complete
    const handleComplete = () => {
      loadStorageInfo();
    };

    downloadManager.on("downloadCompleted", handleComplete);

    return () => {
      downloadManager.off("downloadCompleted", handleComplete);
    };
  }, [loadStorageInfo]);

  return { totalSize, paperCount, isLoading };
}
