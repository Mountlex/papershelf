import { View, FlatList, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useOfflinePapers } from "@/hooks/useOfflinePapers";
import { useStorageInfo } from "@/hooks/useStorageInfo";
import { OfflinePaperCard } from "@/components/OfflinePaperCard";
import { EmptyState } from "@/components/EmptyState";
import { formatBytes } from "@/lib/utils";

export default function OfflineScreen() {
  const { papers, isLoading } = useOfflinePapers();
  const { totalSize, paperCount } = useStorageInfo();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading offline papers...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      {/* Storage info header */}
      <View style={styles.storageHeader}>
        <View style={styles.storageInfo}>
          <Ionicons name="folder-outline" size={20} color="#666" />
          <Text style={styles.storageText}>
            {paperCount} papers · {formatBytes(totalSize)}
          </Text>
        </View>
      </View>

      {papers.length === 0 ? (
        <EmptyState
          icon="cloud-download-outline"
          title="No offline papers"
          message="Download papers from the Papers tab to access them offline."
        />
      ) : (
        <FlatList
          data={papers}
          numColumns={2}
          keyExtractor={(item) => item.paperId}
          renderItem={({ item }) => <OfflinePaperCard paper={item} />}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  storageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  storageInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  storageText: {
    fontSize: 14,
    color: "#666",
  },
  list: {
    padding: 8,
  },
  row: {
    gap: 8,
  },
});
