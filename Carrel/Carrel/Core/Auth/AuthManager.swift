import Foundation
import SwiftUI

@Observable
@MainActor
final class AuthManager {
    private(set) var isAuthenticated = false
    private(set) var isLoading = false

    /// The current Convex Auth token
    private var convexAuthToken: String?

    private let keychain = KeychainManager.shared

    // Configure this for your deployment
    static let siteURL = URL(string: "https://carrelapp.com")!

    init() {}

    // MARK: - Public API

    /// Load stored Convex Auth token and configure ConvexService
    func loadStoredTokens() async {
        isLoading = true
        defer { isLoading = false }

        if let token = await keychain.loadConvexAuthToken() {
            print("AuthManager: Found stored token, authenticating...")
            convexAuthToken = token
            await ConvexService.shared.setAuthToken(token)
            isAuthenticated = true
            print("AuthManager: Restored session, isAuthenticated = true")
        }
    }

    /// Handle OAuth callback with the Convex Auth token
    func handleOAuthCallback(token: String) async {
        print("AuthManager: handleOAuthCallback called with token length: \(token.count)")
        convexAuthToken = token

        // Save to keychain
        do {
            try await keychain.saveConvexAuthToken(token)
            print("AuthManager: Token saved to keychain")
        } catch {
            print("AuthManager: Failed to save token to Keychain: \(error)")
        }

        // Configure ConvexService and wait for authentication to complete
        print("AuthManager: Configuring ConvexService with token")
        await ConvexService.shared.setAuthToken(token)
        isAuthenticated = true
        print("AuthManager: isAuthenticated = true")
    }

    /// Logout and clear all auth state
    func logout() async {
        convexAuthToken = nil
        await ConvexService.shared.clearAuth()
        await keychain.clearConvexAuthToken()
        isAuthenticated = false
    }
}
