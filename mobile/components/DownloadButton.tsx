import { Pressable, StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useDownloadStatus } from "@/hooks/useDownloadStatus";
import { downloadManager, Paper } from "@/lib/downloadManager";
import { removeOfflinePaper } from "@/lib/offlineStorage";
import { Alert } from "react-native";

interface DownloadButtonProps {
  paper: Paper;
  size?: "small" | "medium" | "large";
  showLabel?: boolean;
}

export function DownloadButton({
  paper,
  size = "medium",
  showLabel = false,
}: DownloadButtonProps) {
  const { isOffline, isDownloading, progress } = useDownloadStatus(paper._id);

  const iconSize = size === "small" ? 18 : size === "large" ? 28 : 24;
  const containerSize = size === "small" ? 28 : size === "large" ? 44 : 36;

  const handlePress = () => {
    if (isDownloading) {
      // Cancel download
      Alert.alert("Cancel Download", "Stop downloading this paper?", [
        { text: "No", style: "cancel" },
        {
          text: "Yes",
          onPress: () => downloadManager.cancelDownload(paper._id),
        },
      ]);
    } else if (isOffline) {
      // Show options for offline paper
      Alert.alert(paper.title, "This paper is available offline", [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeOfflinePaper(paper._id);
          },
        },
      ]);
    } else {
      // Start download
      downloadManager.downloadPaper(paper);
    }
  };

  const renderIcon = () => {
    if (isDownloading) {
      // Show progress circle
      return (
        <View style={styles.progressContainer}>
          <CircularProgress progress={progress} size={iconSize} />
        </View>
      );
    }

    if (isOffline) {
      return <Ionicons name="checkmark-circle" size={iconSize} color="#34C759" />;
    }

    return <Ionicons name="download-outline" size={iconSize} color="#007AFF" />;
  };

  const getLabel = () => {
    if (isDownloading) {
      return `${Math.round(progress * 100)}%`;
    }
    if (isOffline) {
      return "Saved";
    }
    return "Save";
  };

  return (
    <Pressable
      style={[
        styles.container,
        {
          width: showLabel ? undefined : containerSize,
          height: containerSize,
          paddingHorizontal: showLabel ? 12 : 0,
        },
      ]}
      onPress={handlePress}
    >
      {renderIcon()}
      {showLabel && <Text style={styles.label}>{getLabel()}</Text>}
    </Pressable>
  );
}

// Simple circular progress indicator
function CircularProgress({
  progress,
  size,
}: {
  progress: number;
  size: number;
}) {
  return (
    <View style={{ width: size, height: size }}>
      {/* Background circle */}
      <View
        style={[
          styles.progressCircle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: "#E5E5EA",
          },
        ]}
      />
      {/* Progress indicator - simplified as a percentage text for now */}
      <View style={[styles.progressText, { width: size, height: size }]}>
        <Text style={{ fontSize: size * 0.35, color: "#007AFF", fontWeight: "600" }}>
          {Math.round(progress * 100)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#007AFF",
  },
  progressContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  progressCircle: {
    position: "absolute",
  },
  progressText: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
  },
});
