import { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, Text, ActivityIndicator, Pressable, Alert } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PdfViewer } from "@/components/PdfViewer";
import { getAccessToken, CONVEX_SITE_URL } from "@/lib/getAccessToken";

interface Paper {
  _id: string;
  title: string;
  authors?: string[];
  pdfUrl?: string | null;
  buildStatus?: string;
  compilationProgress?: string;
  lastSyncError?: string;
  trackedFile?: { pdfSourceType?: string } | null;
}

export default function PaperScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [paper, setPaper] = useState<Paper | null | undefined>(undefined);
  const [isBuilding, setIsBuilding] = useState(false);

  const fetchPaper = useCallback(async () => {
    if (!id) return;

    try {
      const token = await getAccessToken();
      if (!token) {
        setPaper(null);
        return;
      }

      const response = await fetch(`${CONVEX_SITE_URL}/api/mobile/paper?id=${id}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        setPaper(null);
        return;
      }

      const data = await response.json();
      setPaper(data);
    } catch (err) {
      console.error("Error fetching paper:", err);
      setPaper(null);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchPaper();
    }
  }, [id, fetchPaper]);

  // Separate effect for polling during build
  useEffect(() => {
    if (!paper?.buildStatus || (paper.buildStatus !== "building" && !isBuilding)) {
      return;
    }

    const interval = setInterval(fetchPaper, 2000);
    return () => clearInterval(interval);
  }, [paper?.buildStatus, isBuilding, fetchPaper]);

  const pdfSource = paper?.pdfUrl ?? null;
  const canCompile = paper?.trackedFile?.pdfSourceType === "compile";
  const isBuildingFromServer = paper?.buildStatus === "building";

  const handleRecompile = async () => {
    if (!paper || isBuilding || isBuildingFromServer) return;

    try {
      setIsBuilding(true);
      const token = await getAccessToken();
      if (!token) {
        Alert.alert("Error", "Not authenticated");
        return;
      }

      const response = await fetch(`${CONVEX_SITE_URL}/api/mobile/paper/build`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paperId: paper._id, force: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        Alert.alert("Build Failed", data.error || "Failed to recompile paper");
      } else {
        // Refresh paper data
        await fetchPaper();
      }
    } catch (error) {
      Alert.alert(
        "Build Failed",
        error instanceof Error ? error.message : "Failed to recompile paper"
      );
    } finally {
      setIsBuilding(false);
    }
  };

  if (paper === undefined) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="small" color="#000" />
        </View>
      </View>
    );
  }

  if (paper === null) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "" }} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#ccc" />
          <Text style={styles.errorText}>Paper not found</Text>
        </View>
      </View>
    );
  }

  const showBuildingIndicator = isBuilding || isBuildingFromServer;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "",
          headerBackTitle: "Back",
          headerRight: () =>
            canCompile ? (
              <Pressable
                style={({ pressed }) => [
                  styles.headerButton,
                  pressed && styles.headerButtonPressed,
                ]}
                onPress={handleRecompile}
                disabled={showBuildingIndicator}
              >
                {showBuildingIndicator ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Ionicons name="refresh" size={22} color="#000" />
                )}
              </Pressable>
            ) : null,
        }}
      />

      {pdfSource ? (
        <PdfViewer source={pdfSource} />
      ) : (
        <View style={styles.centered}>
          {showBuildingIndicator ? (
            <>
              <ActivityIndicator size="large" color="#000" />
              <Text style={styles.buildingText}>Building PDF...</Text>
              {paper.compilationProgress && (
                <Text style={styles.progressText}>{paper.compilationProgress}</Text>
              )}
            </>
          ) : (
            <>
              <Ionicons name="document-text-outline" size={48} color="#ccc" />
              <Text style={styles.errorText}>No PDF available</Text>
              {canCompile && (
                <Pressable
                  style={({ pressed }) => [
                    styles.buildButton,
                    pressed && styles.buildButtonPressed,
                  ]}
                  onPress={handleRecompile}
                >
                  <Ionicons name="build" size={18} color="#fff" />
                  <Text style={styles.buildButtonText}>Build PDF</Text>
                </Pressable>
              )}
            </>
          )}
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
        {paper.lastSyncError && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning" size={14} color="#c00" />
            <Text style={styles.errorBannerText} numberOfLines={2}>
              {paper.lastSyncError}
            </Text>
          </View>
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
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: 24,
  },
  headerButton: {
    padding: 8,
    marginRight: -8,
  },
  headerButtonPressed: {
    opacity: 0.5,
  },
  errorText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#999",
  },
  buildingText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#000",
  },
  progressText: {
    fontSize: 13,
    color: "#666",
  },
  buildButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#000",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  buildButtonPressed: {
    opacity: 0.7,
  },
  buildButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  authors: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
    padding: 8,
    backgroundColor: "#fff0f0",
    borderRadius: 6,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: "#c00",
  },
});
