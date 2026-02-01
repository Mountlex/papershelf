import SwiftUI
import WebKit

struct OAuthWebView: View {
    let provider: OAuthProvider
    let onSuccess: (String) -> Void  // Now receives just the Convex Auth token

    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                WebView(
                    url: oauthURL,
                    isLoading: $isLoading,
                    onTokenReceived: { token in
                        onSuccess(token)
                    },
                    onError: { errorMessage in
                        error = errorMessage
                    }
                )

                if isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                }
            }
            .navigationTitle("Sign in with \(provider.displayName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") {
                    error = nil
                    dismiss()
                }
            } message: {
                Text(error ?? "Unknown error")
            }
        }
    }

    private var oauthURL: URL {
        var components = URLComponents(url: AuthManager.siteURL.appendingPathComponent("mobile-auth"), resolvingAgainstBaseURL: true)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider.rawValue)
        ]
        return components.url!
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    let onTokenReceived: (String) -> Void  // Now receives just the Convex Auth token
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()

        // Add message handler for receiving tokens from JavaScript
        contentController.add(context.coordinator, name: "carrelAuth")

        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator

        // Store URL for loading after cookie clear
        let urlToLoad = url

        // Clear cookies to ensure fresh login, then load
        let dataStore = WKWebsiteDataStore.default()
        dataStore.removeData(
            ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
            modifiedSince: Date.distantPast
        ) {
            print("WebView cookies cleared, loading URL: \(urlToLoad.absoluteString)")
            DispatchQueue.main.async {
                webView.load(URLRequest(url: urlToLoad))
            }
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: WebView

        init(_ parent: WebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.onError(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("WebView didFailProvisionalNavigation: \(error)")
            print("Failed URL: \(webView.url?.absoluteString ?? "unknown")")
            parent.isLoading = false
            parent.onError(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Check for custom scheme callback
            if let url = navigationAction.request.url,
               url.scheme == "carrel",
               url.host == "auth" {
                // Parse token from URL - now just a single Convex Auth token
                if let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let queryItems = components.queryItems {
                    // Check for errors first
                    if let errorItem = queryItems.first(where: { $0.name == "error" }),
                       let errorMessage = errorItem.value {
                        parent.onError(errorMessage)
                        decisionHandler(.cancel)
                        return
                    }

                    // Check for cancelled
                    if queryItems.contains(where: { $0.name == "cancelled" }) {
                        parent.onError("Authentication cancelled")
                        decisionHandler(.cancel)
                        return
                    }

                    // Get the Convex Auth token (single token)
                    if let tokenItem = queryItems.first(where: { $0.name == "token" }),
                       let token = tokenItem.value {
                        parent.onTokenReceived(token)
                    } else {
                        // Fallback: support legacy format with accessToken
                        if let accessTokenItem = queryItems.first(where: { $0.name == "accessToken" }),
                           let accessToken = accessTokenItem.value {
                            parent.onTokenReceived(accessToken)
                        } else {
                            parent.onError("No authentication token received")
                        }
                    }
                }

                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        // Handle JavaScript postMessage
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "carrelAuth",
                  let body = message.body as? [String: Any] else {
                return
            }

            if let error = body["error"] as? String {
                parent.onError(error)
                return
            }

            // Check for new format (single token)
            if let token = body["token"] as? String {
                parent.onTokenReceived(token)
                return
            }

            // Fallback: support legacy format with accessToken
            if let accessToken = body["accessToken"] as? String {
                parent.onTokenReceived(accessToken)
                return
            }

            parent.onError("Invalid token response")
        }
    }
}

