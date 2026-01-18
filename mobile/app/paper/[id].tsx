import { useState, useEffect } from "react";
import { View, StyleSheet, Text, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Ionicons } from "@expo/vector-icons";
import { PdfViewer } from "@/components/PdfViewer";
import { DownloadButton } from "@/components/DownloadButton";
import { useOfflinePaper } from "@/hooks/useOfflinePapers";
import { getCachedPdfPath } from "@/lib/offlineStorage";

export default function PaperScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paper = useQuery(api.papers.get, { id: id as Id<"papers"> });
  const offlinePaper = useOfflinePaper(id);
  const [pdfSource, setPdfSource] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPdf() {
      setIsLoading(true);

      // Check for offline version first
      if (offlinePaper) {
        const cachedPath = await getCachedPdfPath(id);
        if (cachedPath) {
          setPdfSource(cachedPath);
          setIsLoading(false);
          return;
        }
      }

      // Fall back to online URL
      if (paper?.pdfUrl) {
        setPdfSource(paper.pdfUrl);
      }

      setIsLoading(false);
    }

    if (id) {
      loadPdf();
    }
  }, [id, paper?.pdfUrl, offlinePaper]);

  if (paper === undefined) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (paper === null) {
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={48} color="#999" />
        <Text style={styles.errorText}>Paper not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: paper.title,
          headerRight: () => (
            <View style={styles.headerRight}>
              <DownloadButton paper={paper} />
              <Pressable style={styles.headerButton}>
                <Ionicons name="share-outline" size={24} color="#007AFF" />
              </Pressable>
            </View>
          ),
        }}
      />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading PDF...</Text>
        </View>
      ) : pdfSource ? (
        <PdfViewer source={pdfSource} />
      ) : (
        <View style={styles.error}>
          <Ionicons name="document-outline" size={48} color="#999" />
          <Text style={styles.errorText}>PDF not available</Text>
          <Text style={styles.errorSubtext}>
            Download this paper for offline access
          </Text>
        </View>
      )}

      {/* Paper info footer */}
      <View style={styles.footer}>
        <Text style={styles.title} numberOfLines={2}>
          {paper.title}
        </Text>
        {paper.authors && paper.authors.length > 0 && (
          <Text style={styles.authors} numberOfLines={1}>
            {paper.authors.join(", ")}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  headerButton: {
    padding: 4,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  error: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  errorSubtext: {
    fontSize: 14,
    color: "#666",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
  },
  authors: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
});
