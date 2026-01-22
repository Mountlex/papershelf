import Foundation
import SwiftUI

@Observable
@MainActor
final class SettingsViewModel {
    private(set) var user: User?
    private(set) var isLoading = false
    private(set) var error: String?

    private let authManager: AuthManager
    private var client: ConvexClient {
        ConvexClient(baseURL: AuthManager.baseURL, authManager: authManager)
    }

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    func loadUser() async {
        isLoading = true
        defer { isLoading = false }

        do {
            user = try await client.user()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func logout() async {
        await authManager.logout()
    }

    func clearError() {
        error = nil
    }
}
