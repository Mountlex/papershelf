import { useState } from "react";
import { View, StyleSheet, Text, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

interface PdfViewerProps {
  source: string;
}

export function PdfViewer({ source }: PdfViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use Google Docs viewer to display PDF
  const googleDocsUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(source)}`;

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: googleDocsUrl }}
        style={styles.webview}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setError("Failed to load PDF");
          setIsLoading(false);
        }}
        onHttpError={(e) => {
          setError(`HTTP error: ${e.nativeEvent.statusCode}`);
          setIsLoading(false);
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
      />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#000" />
          <Text style={styles.loadingText}>Loading PDF...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f0f0",
  },
  webview: {
    flex: 1,
    backgroundColor: "#f0f0f0",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
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
    fontSize: 15,
    color: "#c00",
    textAlign: "center",
  },
});
