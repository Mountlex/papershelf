import { View, Text, Image, StyleSheet, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OfflinePaper, removeOfflinePaper } from "@/lib/offlineStorage";
import { formatBytes, formatRelativeTime } from "@/lib/utils";

interface OfflinePaperCardProps {
  paper: OfflinePaper;
}

export function OfflinePaperCard({ paper }: OfflinePaperCardProps) {
  const router = useRouter();

  const handlePress = () => {
    router.push(`/paper/${paper.paperId}`);
  };

  const handleLongPress = () => {
    Alert.alert(paper.title, `${formatBytes(paper.fileSize)}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove from Offline",
        style: "destructive",
        onPress: async () => {
          await removeOfflinePaper(paper.paperId);
        },
      },
    ]);
  };

  return (
    <Pressable
      style={styles.container}
      onPress={handlePress}
      onLongPress={handleLongPress}
    >
      {/* Thumbnail */}
      <View style={styles.thumbnailContainer}>
        {paper.thumbnailPath ? (
          <Image
            source={{ uri: `file://${paper.thumbnailPath}` }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholderThumbnail}>
            <Ionicons name="document-text-outline" size={32} color="#ccc" />
          </View>
        )}

        {/* Offline badge */}
        <View style={styles.offlineBadge}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
        </View>

        {/* File size badge */}
        <View style={styles.sizeBadge}>
          <Text style={styles.sizeText}>{formatBytes(paper.fileSize)}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {paper.title}
        </Text>
        {paper.authors && (
          <Text style={styles.authors} numberOfLines={1}>
            {paper.authors}
          </Text>
        )}
        <Text style={styles.savedAt}>
          Saved {formatRelativeTime(paper.savedAt)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  thumbnailContainer: {
    aspectRatio: 0.75,
    backgroundColor: "#f5f5f5",
    position: "relative",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  placeholderThumbnail: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
  },
  offlineBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "#34C759",
    borderRadius: 10,
    padding: 2,
  },
  sizeBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sizeText: {
    fontSize: 10,
    color: "#fff",
    fontWeight: "500",
  },
  info: {
    padding: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111",
    lineHeight: 18,
  },
  authors: {
    fontSize: 11,
    color: "#666",
    marginTop: 4,
  },
  savedAt: {
    fontSize: 10,
    color: "#999",
    marginTop: 4,
  },
});
