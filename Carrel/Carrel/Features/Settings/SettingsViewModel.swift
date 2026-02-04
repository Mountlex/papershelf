import Foundation
import SwiftUI

@Observable
@MainActor
final class SettingsViewModel {
    private(set) var user: User?
    private(set) var isLoading = false
    private(set) var error: String?
    var notificationPreferences: NotificationPreferences = .default
    private(set) var isNotificationsLoading = false
    private(set) var isNotificationsUpdating = false

    private let authManager: AuthManager

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    func loadUser() async {
        isLoading = true
        defer { isLoading = false }

        do {
            user = try await ConvexService.shared.getViewer()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadNotificationPreferences() async {
        isNotificationsLoading = true
        defer { isNotificationsLoading = false }

        do {
            notificationPreferences = try await ConvexService.shared.getNotificationPreferences()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func updateNotificationPreferences() async {
        isNotificationsUpdating = true
        defer { isNotificationsUpdating = false }

        do {
            try await ConvexService.shared.updateNotificationPreferences(notificationPreferences)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func sendTestNotification() async {
        isNotificationsUpdating = true
        defer { isNotificationsUpdating = false }

        do {
            let result = try await ConvexService.shared.sendTestNotification()
            if result.delivered == 0 {
                self.error = result.reason == "disabled"
                    ? "Enable notifications to send a test."
                    : "No device tokens registered yet."
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setError(_ message: String) {
        error = message
    }

    func logout() async {
        await authManager.logout()
    }

    func clearError() {
        error = nil
    }
}
