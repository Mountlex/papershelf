import { useState } from "react";
import { View, StyleSheet, Text, ActivityIndicator } from "react-native";
import Pdf from "react-native-pdf";

interface PdfViewerProps {
  source: string; // URL or local file path
}

export function PdfViewer({ source }: PdfViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine if source is a local file or URL
  const pdfSource = source.startsWith("file://") || source.startsWith("/")
    ? { uri: source.startsWith("/") ? `file://${source}` : source, cache: true }
    : { uri: source, cache: true };

  return (
    <View style={styles.container}>
      <Pdf
        source={pdfSource}
        style={styles.pdf}
        trustAllCerts={false}
        onLoadComplete={(numberOfPages) => {
          setTotalPages(numberOfPages);
          setIsLoading(false);
        }}
        onPageChanged={(page) => {
          setCurrentPage(page);
        }}
        onError={(err) => {
          console.error("PDF Error:", err);
          setError("Failed to load PDF");
          setIsLoading(false);
        }}
        enablePaging={true}
        horizontal={false}
        enableAntialiasing={true}
        enableAnnotationRendering={true}
        fitPolicy={0} // Fit width
        spacing={0}
      />

      {/* Loading overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading PDF...</Text>
        </View>
      )}

      {/* Error state */}
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Page indicator */}
      {totalPages > 0 && !isLoading && (
        <View style={styles.pageIndicator}>
          <Text style={styles.pageText}>
            {currentPage} / {totalPages}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#333",
  },
  pdf: {
    flex: 1,
    backgroundColor: "#333",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
  },
  pageIndicator: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  pageText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
});
