import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useDownloadQueue } from "@/hooks/useDownloadStatus";
import { useOfflinePapers } from "@/hooks/useOfflinePapers";
import { downloadManager, Paper } from "@/lib/downloadManager";

interface DownloadAllBannerProps {
  papers: Paper[];
}

export function DownloadAllBanner({ papers }: DownloadAllBannerProps) {
  const { papers: offlinePapers } = useOfflinePapers();
  const queueStatus = useDownloadQueue();

  const offlineCount = offlinePapers.length;
  const totalCount = papers.length;
  const allDownloaded = offlineCount >= totalCount && totalCount > 0;

  // Calculate papers not yet downloaded
  const offlineIds = new Set(offlinePapers.map((p) => p.paperId));
  const papersToDownload = papers.filter((p) => !offlineIds.has(p._id));

  const handleDownloadAll = () => {
    downloadManager.downloadAll(papersToDownload);
  };

  const handleCancel = () => {
    downloadManager.cancelAll();
  };

  // Show download progress
  if (queueStatus.total > 0) {
    const completed = totalCount - queueStatus.total - offlineCount;
    const progressPercent = Math.round(
      ((offlineCount + completed) / totalCount) * 100
    );

    return (
      <View style={styles.container}>
        <View style={styles.progressRow}>
          <View style={styles.progressInfo}>
            <Ionicons name="cloud-download-outline" size={20} color="#007AFF" />
            <Text style={styles.progressText}>
              Downloading... {queueStatus.pending + queueStatus.downloading} remaining
            </Text>
          </View>
          <Pressable onPress={handleCancel} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        {/* Progress bar */}
        <View style={styles.progressBarContainer}>
          <View
            style={[styles.progressBar, { width: `${progressPercent}%` }]}
          />
        </View>
      </View>
    );
  }

  // All downloaded
  if (allDownloaded) {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <Ionicons name="checkmark-circle" size={20} color="#34C759" />
        <Text style={styles.successText}>
          All {totalCount} papers available offline
        </Text>
      </View>
    );
  }

  // Show download all button
  if (papersToDownload.length > 0) {
    return (
      <View style={styles.container}>
        <View style={styles.infoRow}>
          <Text style={styles.infoText}>
            {offlineCount} of {totalCount} papers offline
          </Text>
          <Pressable onPress={handleDownloadAll} style={styles.downloadButton}>
            <Ionicons name="download-outline" size={18} color="#007AFF" />
            <Text style={styles.downloadText}>
              Download {papersToDownload.length}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // No papers
  return null;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  successContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  successText: {
    fontSize: 14,
    color: "#34C759",
    fontWeight: "500",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoText: {
    fontSize: 14,
    color: "#666",
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0F8FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  downloadText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#007AFF",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressText: {
    fontSize: 14,
    color: "#333",
  },
  cancelButton: {
    padding: 4,
  },
  cancelText: {
    fontSize: 14,
    color: "#FF3B30",
    fontWeight: "500",
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: "#E5E5EA",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#007AFF",
    borderRadius: 2,
  },
});
