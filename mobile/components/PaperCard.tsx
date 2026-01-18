import { View, Text, Image, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { DownloadButton } from "./DownloadButton";
import { useDownloadStatus } from "@/hooks/useDownloadStatus";

interface Paper {
  _id: string;
  title: string;
  authors?: string[];
  thumbnailUrl?: string;
  pdfUrl?: string;
  pageCount?: number;
}

interface PaperCardProps {
  paper: Paper;
}

export function PaperCard({ paper }: PaperCardProps) {
  const router = useRouter();
  const { isOffline } = useDownloadStatus(paper._id);

  const handlePress = () => {
    router.push(`/paper/${paper._id}`);
  };

  return (
    <Pressable style={styles.container} onPress={handlePress}>
      {/* Thumbnail */}
      <View style={styles.thumbnailContainer}>
        {paper.thumbnailUrl ? (
          <Image
            source={{ uri: paper.thumbnailUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholderThumbnail}>
            <Ionicons name="document-text-outline" size={32} color="#ccc" />
          </View>
        )}

        {/* Offline indicator */}
        {isOffline && (
          <View style={styles.offlineBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
          </View>
        )}

        {/* Download button overlay */}
        <View style={styles.downloadOverlay}>
          <DownloadButton paper={paper} size="small" />
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {paper.title}
        </Text>
        {paper.authors && paper.authors.length > 0 && (
          <Text style={styles.authors} numberOfLines={1}>
            {paper.authors.join(", ")}
          </Text>
        )}
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
  downloadOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
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
});
