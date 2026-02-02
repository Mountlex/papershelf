import Foundation
import SwiftUI
import AuthenticationServices

@Observable
@MainActor
final class AuthManager {
    private(set) var isAuthenticated = false
    private(set) var isLoading = false

    /// Whether a token refresh is needed (token expiring soon)
    private(set) var needsTokenRefresh = false

    /// The current Convex Auth token
    private var convexAuthToken: String?

    private let keychain = KeychainManager.shared

    /// How long before expiration to trigger a refresh (5 minutes)
    private let refreshThreshold: TimeInterval = 5 * 60

    /// Base URL for the web app. Configure this for your deployment.
    /// Uses Info.plist value if available, otherwise falls back to default.
    static let siteURL: URL = {
        if let urlString = Bundle.main.object(forInfoDictionaryKey: "CarrelSiteURL") as? String,
           let url = URL(string: urlString) {
            return url
        }
        // Fallback to default - this URL is known to be valid
        return URL(string: "https://carrelapp.com")!
    }()

    init() {}

    // MARK: - Public API

    /// Load stored Convex Auth token and configure ConvexService
    func loadStoredTokens() async {
        isLoading = true
        defer { isLoading = false }

        if let token = await keychain.loadConvexAuthToken() {
            // Check if token is expired before trying to use it
            if isTokenExpired(token) {
                #if DEBUG
                print("AuthManager: Stored token is expired, attempting refresh...")
                #endif

                // Try to refresh the token automatically
                let refreshed = await refreshToken()
                if !refreshed {
                    #if DEBUG
                    print("AuthManager: Token refresh failed, requiring re-login")
                    #endif
                    convexAuthToken = nil
                    await keychain.clearConvexAuthToken()
                    isAuthenticated = false
                }
                return
            }

            // Check if token is expiring soon - set flag for background refresh
            if isTokenExpiringSoon(token) {
                #if DEBUG
                print("AuthManager: Token expiring soon, will refresh in background")
                #endif
                needsTokenRefresh = true
            }

            #if DEBUG
            print("AuthManager: Found stored token, authenticating...")
            #endif
            let success = await ConvexService.shared.setAuthToken(token)

            if success {
                convexAuthToken = token
                isAuthenticated = true
                #if DEBUG
                print("AuthManager: Restored session, isAuthenticated = true")
                #endif

                // If token is expiring soon, refresh it in the background
                if needsTokenRefresh {
                    Task {
                        _ = await refreshToken()
                    }
                }
            } else {
                // Token is invalid/expired - clear it and require re-login
                #if DEBUG
                print("AuthManager: Stored token is invalid, clearing and requiring re-login")
                #endif
                convexAuthToken = nil
                await keychain.clearConvexAuthToken()
                isAuthenticated = false
            }
        }
    }

    // MARK: - Token Refresh

    /// Attempt to refresh the token by re-authenticating
    /// Returns the new token if successful, nil otherwise
    func refreshToken() async -> Bool {
        #if DEBUG
        print("AuthManager: Attempting token refresh...")
        #endif

        return await withCheckedContinuation { continuation in
            // Open mobile-auth without a provider - if user has a valid web session,
            // they'll get a new token automatically. Otherwise, they'll see the login screen.
            let url = Self.siteURL.appendingPathComponent("mobile-auth")

            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "carrel"
            ) { [weak self] callbackURL, error in
                guard let self = self else {
                    continuation.resume(returning: false)
                    return
                }

                if error != nil {
                    #if DEBUG
                    print("AuthManager: Token refresh failed: \(error!.localizedDescription)")
                    #endif
                    continuation.resume(returning: false)
                    return
                }

                guard let callbackURL = callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                      let queryItems = components.queryItems,
                      let tokenItem = queryItems.first(where: { $0.name == "token" }),
                      let token = tokenItem.value else {
                    continuation.resume(returning: false)
                    return
                }

                Task { @MainActor in
                    await self.handleOAuthCallback(token: token)
                    self.needsTokenRefresh = false
                    #if DEBUG
                    print("AuthManager: Token refresh successful")
                    #endif
                    continuation.resume(returning: true)
                }
            }

            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = WebAuthContextProvider.shared
            session.start()
        }
    }

    // MARK: - Token Validation

    /// Check if a JWT token is expired
    private func isTokenExpired(_ token: String) -> Bool {
        let remaining = tokenTimeRemaining(token)
        return remaining <= 0
    }

    /// Check if a JWT token is expiring soon
    private func isTokenExpiringSoon(_ token: String) -> Bool {
        let remaining = tokenTimeRemaining(token)
        return remaining > 0 && remaining < refreshThreshold
    }

    /// Get the time remaining before token expires (in seconds)
    private func tokenTimeRemaining(_ token: String) -> TimeInterval {
        // JWT format: header.payload.signature
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return 0 }

        // Decode the payload (base64url encoded)
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // Add padding if needed
        while base64.count % 4 != 0 {
            base64.append("=")
        }

        guard let payloadData = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let exp = payload["exp"] as? TimeInterval else {
            return 0
        }

        let expirationDate = Date(timeIntervalSince1970: exp)
        let remaining = expirationDate.timeIntervalSinceNow

        #if DEBUG
        if remaining <= 0 {
            print("AuthManager: Token expired at \(expirationDate)")
        } else {
            print("AuthManager: Token valid, expires in \(Int(remaining / 60)) minutes")
        }
        #endif

        return remaining
    }

    /// Handle OAuth callback with the Convex Auth token
    func handleOAuthCallback(token: String) async {
        #if DEBUG
        print("AuthManager: handleOAuthCallback called with token length: \(token.count)")
        #endif
        convexAuthToken = token

        // Save to keychain
        do {
            try await keychain.saveConvexAuthToken(token)
            #if DEBUG
            print("AuthManager: Token saved to keychain")
            #endif
        } catch {
            #if DEBUG
            print("AuthManager: Failed to save token to Keychain: \(error)")
            #endif
        }

        // Configure ConvexService and wait for authentication to complete
        #if DEBUG
        print("AuthManager: Configuring ConvexService with token")
        #endif
        await ConvexService.shared.setAuthToken(token)
        isAuthenticated = true
        #if DEBUG
        print("AuthManager: isAuthenticated = true")
        #endif
    }

    /// Logout and clear all auth state
    func logout() async {
        convexAuthToken = nil
        await ConvexService.shared.clearAuth()
        await keychain.clearConvexAuthToken()

        // Clear user data caches for security
        await PDFCache.shared.clearCache()
        await ThumbnailCache.shared.clearCache()

        isAuthenticated = false
    }
}
