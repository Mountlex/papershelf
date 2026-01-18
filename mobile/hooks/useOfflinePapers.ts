import { useState, useEffect, useCallback } from "react";
import {
  getOfflinePapers,
  getOfflinePaper,
  OfflinePaper,
  initDatabase,
} from "@/lib/offlineStorage";
import { downloadManager } from "@/lib/downloadManager";

/**
 * Hook to get all offline papers
 */
export function useOfflinePapers() {
  const [papers, setPapers] = useState<OfflinePaper[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadPapers = useCallback(async () => {
    try {
      await initDatabase();
      const offlinePapers = await getOfflinePapers();
      setPapers(offlinePapers);
    } catch (error) {
      console.error("Error loading offline papers:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPapers();

    // Refresh when downloads complete
    const handleComplete = () => {
      loadPapers();
    };

    downloadManager.on("downloadCompleted", handleComplete);

    return () => {
      downloadManager.off("downloadCompleted", handleComplete);
    };
  }, [loadPapers]);

  return { papers, isLoading, refresh: loadPapers };
}

/**
 * Hook to check if a specific paper is offline
 */
export function useOfflinePaper(paperId: string | undefined) {
  const [paper, setPaper] = useState<OfflinePaper | null>(null);

  useEffect(() => {
    async function load() {
      if (!paperId) {
        setPaper(null);
        return;
      }

      try {
        await initDatabase();
        const offlinePaper = await getOfflinePaper(paperId);
        setPaper(offlinePaper);
      } catch (error) {
        console.error("Error loading offline paper:", error);
      }
    }

    load();

    // Refresh when this paper completes downloading
    const handleComplete = (completedPaperId: string) => {
      if (completedPaperId === paperId) {
        load();
      }
    };

    downloadManager.on("downloadCompleted", handleComplete);

    return () => {
      downloadManager.off("downloadCompleted", handleComplete);
    };
  }, [paperId]);

  return paper;
}
