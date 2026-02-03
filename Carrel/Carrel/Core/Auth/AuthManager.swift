import Foundation
import SwiftUI
import AuthenticationServices
import UIKit

@Observable
@MainActor
final class AuthManager {
    private(set) var isAuthenticated = false
    private(set) var isLoading = false

    /// Whether a token refresh is in progress
    private var isRefreshing = false

    /// The current access token (JWT)
    private var accessToken: String?

    private let keychain = KeychainManager.shared

    /// How long before expiration to trigger a refresh (7 days)
    private let refreshThreshold: TimeInterval = 7 * 24 * 60 * 60

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

    /// Convex HTTP endpoint URL (uses .site domain, not .cloud)
    private static var convexHTTPURL: URL {
        if let urlString = Bundle.main.object(forInfoDictionaryKey: "ConvexDeploymentURL") as? String {
            // Convert .cloud to .site for HTTP endpoints
            let siteUrl = urlString.replacingOccurrences(of: ".convex.cloud", with: ".convex.site")
            if let url = URL(string: siteUrl) {
                return url
            }
        }
        return URL(string: "https://kindhearted-bloodhound-95.convex.site")!
    }

    init() {}

    // MARK: - Public API

    /// Load stored tokens and configure ConvexService
    func loadStoredTokens() async {
        isLoading = true
        defer { isLoading = false }

        guard let token = await keychain.loadConvexAuthToken() else {
            #if DEBUG
            print("AuthManager: No stored token found")
            #endif
            return
        }

        // Check if token is expired
        if isTokenExpired(token) {
            #if DEBUG
            print("AuthManager: Stored token is expired, attempting silent refresh...")
            #endif

            // Try to refresh using refresh token
            let refreshed = await refreshTokenSilently()
            if !refreshed {
                #if DEBUG
                print("AuthManager: Silent refresh failed, clearing tokens")
                #endif
                await keychain.clearAllTokens()
                isAuthenticated = false
            }
            return
        }

        // Check if token is expiring soon - refresh in background
        if isTokenExpiringSoon(token) {
            #if DEBUG
            print("AuthManager: Token expiring soon, will refresh in background")
            #endif
            Task {
                _ = await refreshTokenSilently()
            }
        }

        #if DEBUG
        print("AuthManager: Found stored token, authenticating...")
        #endif

        let success = await ConvexService.shared.setAuthToken(token)

        if success {
            accessToken = token
            isAuthenticated = true
            #if DEBUG
            print("AuthManager: Restored session, isAuthenticated = true")
            #endif
        } else {
            #if DEBUG
            print("AuthManager: Stored token is invalid, attempting silent refresh...")
            #endif
            let refreshed = await refreshTokenSilently()
            if !refreshed {
                await keychain.clearAllTokens()
                isAuthenticated = false
            }
        }
    }

    // MARK: - Silent Token Refresh

    /// Refresh the access token using the stored refresh token (no user interaction)
    /// Returns true if refresh succeeded, false otherwise
    func refreshTokenSilently() async -> Bool {
        // Prevent concurrent refresh attempts
        guard !isRefreshing else {
            #if DEBUG
            print("AuthManager: Refresh already in progress, skipping")
            #endif
            return false
        }

        guard let refreshToken = await keychain.loadRefreshToken() else {
            #if DEBUG
            print("AuthManager: No refresh token available")
            #endif
            return false
        }

        isRefreshing = true
        defer { isRefreshing = false }

        #if DEBUG
        print("AuthManager: Attempting silent token refresh...")
        #endif

        // Call the refresh endpoint
        let url = Self.convexHTTPURL.appendingPathComponent("api/mobile/refresh")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["refreshToken": refreshToken]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                #if DEBUG
                print("AuthManager: Invalid response from refresh endpoint")
                #endif
                return false
            }

            if httpResponse.statusCode == 200 {
                let result = try JSONDecoder().decode(TokenResponse.self, from: data)

                // Save the new Convex Auth-compatible token
                try await keychain.saveConvexAuthToken(result.accessToken)

                // Configure ConvexService with new token
                let success = await ConvexService.shared.setAuthToken(result.accessToken)
                if success {
                    accessToken = result.accessToken
                    isAuthenticated = true

                    #if DEBUG
                    let daysRemaining = (result.expiresAt - Date().timeIntervalSince1970 * 1000) / (1000 * 60 * 60 * 24)
                    print("AuthManager: Silent refresh successful, token expires in \(Int(daysRemaining)) days")
                    #endif
                    return true
                } else {
                    #if DEBUG
                    print("AuthManager: Convex rejected the refreshed token")
                    #endif
                    return false
                }
            } else {
                #if DEBUG
                let responseBody = String(data: data, encoding: .utf8) ?? "no body"
                print("AuthManager: Refresh failed with status \(httpResponse.statusCode): \(responseBody)")
                #endif
                // Clear invalid refresh token
                await keychain.clearRefreshToken()
                return false
            }
        } catch {
            #if DEBUG
            print("AuthManager: Refresh request failed: \(error)")
            #endif
            return false
        }
    }

    // MARK: - Interactive Token Refresh (Fallback)

    /// Attempt to refresh the token via web authentication (requires user interaction)
    func refreshTokenInteractive() async -> Bool {
        #if DEBUG
        print("AuthManager: Attempting interactive token refresh...")
        #endif

        return await withCheckedContinuation { continuation in
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
                    print("AuthManager: Interactive refresh failed: \(error!.localizedDescription)")
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
                    #if DEBUG
                    print("AuthManager: Interactive refresh successful")
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
        } else if remaining > 24 * 60 * 60 {
            print("AuthManager: Token valid, expires in \(Int(remaining / (24 * 60 * 60))) days")
        } else {
            print("AuthManager: Token valid, expires in \(Int(remaining / 60)) minutes")
        }
        #endif

        return remaining
    }

    /// Handle OAuth callback with the Convex Auth token
    /// Exchanges the short-lived Convex Auth token for a 90-day token + refresh token
    func handleOAuthCallback(token: String) async {
        #if DEBUG
        print("AuthManager: handleOAuthCallback called, exchanging for 90-day token...")
        #endif

        // Exchange the Convex Auth token for a 90-day Convex Auth-compatible token + refresh token
        let url = Self.convexHTTPURL.appendingPathComponent("api/mobile/exchange")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let deviceId = await UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        let deviceName = await UIDevice.current.name
        let body: [String: Any] = [
            "convexToken": token,
            "deviceId": deviceId,
            "deviceName": deviceName,
            "platform": "ios"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                #if DEBUG
                print("AuthManager: Token exchange failed - no HTTP response, using original token")
                #endif
                await useTokenDirectly(token)
                return
            }

            if httpResponse.statusCode != 200 {
                #if DEBUG
                let responseBody = String(data: data, encoding: .utf8) ?? "no body"
                print("AuthManager: Token exchange failed - status \(httpResponse.statusCode): \(responseBody)")
                #endif
                await useTokenDirectly(token)
                return
            }

            let result = try JSONDecoder().decode(TokenResponse.self, from: data)

            // Save the 90-day access token
            try await keychain.saveConvexAuthToken(result.accessToken)

            // Save the refresh token
            if let refreshToken = result.refreshToken {
                try await keychain.saveRefreshToken(refreshToken)
            }

            // Configure ConvexService with the 90-day token
            let success = await ConvexService.shared.setAuthToken(result.accessToken)
            if success {
                accessToken = result.accessToken
                isAuthenticated = true

                #if DEBUG
                let daysRemaining = (result.expiresAt - Date().timeIntervalSince1970 * 1000) / (1000 * 60 * 60 * 24)
                print("AuthManager: Token exchange successful, token expires in \(Int(daysRemaining)) days")
                #endif
            } else {
                #if DEBUG
                print("AuthManager: Convex rejected the exchanged token, using original")
                #endif
                await useTokenDirectly(token)
            }
        } catch {
            #if DEBUG
            print("AuthManager: Token exchange error: \(error), using original token")
            #endif
            await useTokenDirectly(token)
        }
    }

    /// Fallback: use the original Convex Auth token directly
    private func useTokenDirectly(_ token: String) async {
        do {
            try await keychain.saveConvexAuthToken(token)
        } catch {
            #if DEBUG
            print("AuthManager: Failed to save token to Keychain: \(error)")
            #endif
        }

        let success = await ConvexService.shared.setAuthToken(token)
        if success {
            accessToken = token
            isAuthenticated = true
            #if DEBUG
            print("AuthManager: Using original Convex Auth token (expires in ~1 hour)")
            #endif
        }
    }

    /// Logout and clear all auth state
    func logout() async {
        accessToken = nil
        await ConvexService.shared.clearAuth()
        await keychain.clearAllTokens()

        // Clear user data caches for security
        await PDFCache.shared.clearCache()
        await ThumbnailCache.shared.clearCache()

        isAuthenticated = false
    }
}

// MARK: - Token Response

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresAt: Double
    let refreshExpiresAt: Double?
    let tokenType: String?
}
