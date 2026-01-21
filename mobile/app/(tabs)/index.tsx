import { useState, useCallback, useEffect } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { PaperCard } from "@/components/PaperCard";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/lib/useAuth";
import { getAccessToken, CONVEX_SITE_URL } from "@/lib/getAccessToken";

interface Paper {
  _id: string;
  title: string;
  authors?: string[];
  thumbnailUrl?: string | null;
  pdfUrl?: string | null;
  isUpToDate?: boolean | null;
  buildStatus?: string;
  pdfSourceType?: string | null;
}

export default function PapersScreen() {
  const { isAuthenticated } = useAuth();
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPapers = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        setError("Not authenticated");
        setPapers([]);
        return;
      }

      const response = await fetch(`${CONVEX_SITE_URL}/api/mobile/papers`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to fetch papers");
        setPapers([]);
        return;
      }

      const data = await response.json();
      setPapers(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching papers:", err);
      setError("Failed to fetch papers");
      setPapers([]);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPapers();
    }
  }, [isAuthenticated, fetchPapers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPapers();
    setRefreshing(false);
  }, [fetchPapers]);

  if (papers === null) {
    return (
      <View style={styles.container}>
        <View style={styles.loading}>
          <ActivityIndicator size="small" color="#000" />
        </View>
      </View>
    );
  }

  if (papers.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="documents-outline"
          title={error || "No papers yet"}
          message={error ? "Please try again later." : "Add a repository from the web app to get started."}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={papers}
        numColumns={2}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => <PaperCard paper={item} />}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#000"
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 12,
    paddingTop: 8,
  },
  row: {
    gap: 12,
  },
});
