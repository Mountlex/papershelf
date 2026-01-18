import { useState, useCallback } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
} from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { SafeAreaView } from "react-native-safe-area-context";
import { PaperCard } from "@/components/PaperCard";
import { DownloadAllBanner } from "@/components/DownloadAllBanner";
import { EmptyState } from "@/components/EmptyState";

export default function PapersScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const papers = useQuery(api.papers.list);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Convex auto-refreshes, but we can trigger a sync here
    // await triggerSync();
    setRefreshing(false);
  }, []);

  if (papers === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading papers...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (papers.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="document-outline"
          title="No papers yet"
          message="Add repositories or upload PDFs from the web app to see them here."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <DownloadAllBanner papers={papers} />
      <FlatList
        data={papers}
        numColumns={2}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => <PaperCard paper={item} />}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      />
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
  list: {
    padding: 8,
  },
  row: {
    gap: 8,
  },
});
