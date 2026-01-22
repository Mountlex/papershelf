import Foundation
import SwiftUI

@Observable
@MainActor
final class AuthManager {
    private(set) var isAuthenticated = false
    private(set) var isLoading = false

    private var accessToken: String?
    private var refreshToken: String?
    private var accessTokenExpiry: Date?
    private var refreshTokenExpiry: Date?

    private let keychain = KeychainManager.shared
    private var refreshTask: Task<String, Error>?

    // Configure these for your deployment
    static let baseURL = URL(string: "https://earnest-eel-967.convex.site")!
    static let siteURL = URL(string: "https://carrel.app")!

    init() {}

    // MARK: - Public API

    func loadStoredTokens() async {
        isLoading = true
        defer { isLoading = false }

        if let stored = await keychain.loadTokens() {
            accessToken = stored.accessToken
            refreshToken = stored.refreshToken
            accessTokenExpiry = stored.accessTokenExpiry
            refreshTokenExpiry = stored.refreshTokenExpiry

            // Check if tokens are still valid
            if stored.isAccessTokenValid {
                isAuthenticated = true
            } else if stored.isRefreshTokenValid {
                // Try to refresh
                do {
                    _ = try await refreshAccessToken()
                    isAuthenticated = true
                } catch {
                    // Refresh failed, need to re-authenticate
                    await clearTokens()
                }
            } else {
                // All tokens expired
                await clearTokens()
            }
        }
    }

    func getValidToken() async throws -> String {
        // If we have a valid access token, return it
        if let token = accessToken,
           let expiry = accessTokenExpiry,
           expiry > Date().addingTimeInterval(60) {
            return token
        }

        // Need to refresh
        return try await refreshAccessToken()
    }

    func handleOAuthCallback(tokens: AuthTokens) async {
        accessToken = tokens.accessToken
        refreshToken = tokens.refreshToken
        accessTokenExpiry = tokens.expiresAt
        refreshTokenExpiry = tokens.refreshExpiresAt

        do {
            try await keychain.saveTokens(tokens)
        } catch {
            print("Failed to save tokens to Keychain: \(error)")
        }

        isAuthenticated = true
    }

    func logout() async {
        // Revoke the refresh token on the server
        if let refreshToken = refreshToken {
            let client = ConvexClient(baseURL: Self.baseURL, authManager: self)
            do {
                try await client.revokeToken(refreshToken)
            } catch {
                print("Failed to revoke token: \(error)")
            }
        }

        await clearTokens()
    }

    // MARK: - Private

    private func refreshAccessToken() async throws -> String {
        // Deduplicate concurrent refresh requests
        if let existingTask = refreshTask {
            return try await existingTask.value
        }

        let task = Task<String, Error> {
            defer { refreshTask = nil }

            guard let refreshToken = self.refreshToken else {
                throw APIError.tokenExpired
            }

            let client = ConvexClient(baseURL: Self.baseURL, authManager: self)
            let response = try await client.refreshToken(refreshToken)

            await MainActor.run {
                self.accessToken = response.accessToken
                self.accessTokenExpiry = response.expiresAt
            }

            // Update keychain
            let tokens = AuthTokens(
                accessToken: response.accessToken,
                refreshToken: refreshToken,
                expiresAt: response.expiresAt,
                refreshExpiresAt: self.refreshTokenExpiry
            )
            try await keychain.saveTokens(tokens)

            return response.accessToken
        }

        refreshTask = task
        return try await task.value
    }

    private func clearTokens() async {
        accessToken = nil
        refreshToken = nil
        accessTokenExpiry = nil
        refreshTokenExpiry = nil
        isAuthenticated = false
        await keychain.clearTokens()
    }
}
