import SwiftUI
import WebKit

struct OAuthWebView: View {
    let provider: OAuthProvider
    let onSuccess: (AuthTokens) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                WebView(
                    url: oauthURL,
                    isLoading: $isLoading,
                    onTokenReceived: { tokens in
                        onSuccess(tokens)
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
    let onTokenReceived: (AuthTokens) -> Void
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

        // Clear cookies to ensure fresh login
        let dataStore = WKWebsiteDataStore.default()
        dataStore.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
            for record in records {
                dataStore.removeData(ofTypes: record.dataTypes, for: [record]) {}
            }
        }

        webView.load(URLRequest(url: url))
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

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Check for custom scheme callback
            if let url = navigationAction.request.url,
               url.scheme == "carrel",
               url.host == "auth" {
                // Parse tokens from URL
                if let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let queryItems = components.queryItems {
                    var accessToken: String?
                    var refreshToken: String?
                    var expiresAt: Double?
                    var refreshExpiresAt: Double?

                    for item in queryItems {
                        switch item.name {
                        case "accessToken": accessToken = item.value
                        case "refreshToken": refreshToken = item.value
                        case "expiresAt": expiresAt = Double(item.value ?? "")
                        case "refreshExpiresAt": refreshExpiresAt = Double(item.value ?? "")
                        default: break
                        }
                    }

                    if let accessToken = accessToken, let expiresAt = expiresAt {
                        let tokens = AuthTokens(
                            accessToken: accessToken,
                            refreshToken: refreshToken,
                            expiresAt: Date(timeIntervalSince1970: expiresAt / 1000),
                            refreshExpiresAt: refreshExpiresAt.map { Date(timeIntervalSince1970: $0 / 1000) }
                        )
                        parent.onTokenReceived(tokens)
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

            guard let accessToken = body["accessToken"] as? String,
                  let expiresAt = body["expiresAt"] as? Double else {
                parent.onError("Invalid token response")
                return
            }

            let refreshToken = body["refreshToken"] as? String
            let refreshExpiresAt = body["refreshExpiresAt"] as? Double

            let tokens = AuthTokens(
                accessToken: accessToken,
                refreshToken: refreshToken,
                expiresAt: Date(timeIntervalSince1970: expiresAt / 1000),
                refreshExpiresAt: refreshExpiresAt.map { Date(timeIntervalSince1970: $0 / 1000) }
            )
            parent.onTokenReceived(tokens)
        }
    }
}
