import Foundation
import SwiftUI
import UserNotifications
import UIKit

@Observable
@MainActor
final class PushNotificationManager {
    static let shared = PushNotificationManager()

    private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    private var deviceToken: String?
    private var lastRegisteredToken: String?
    private var isAuthenticated = false

    private init() {}

    private var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus

        if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
            registerForRemoteNotifications()
            return true
        }

        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            await refreshAuthorizationStatus()
            if granted {
                registerForRemoteNotifications()
            }
            return granted
        } catch {
            return false
        }
    }

    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func setAuthenticated(_ authenticated: Bool) {
        isAuthenticated = authenticated
        Task { await registerTokenIfPossible() }
    }

    func updateDeviceToken(_ data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        Task { await registerTokenIfPossible() }
    }

    func unregisterDeviceToken() async {
        guard let token = deviceToken else { return }
        do {
            try await ConvexService.shared.unregisterDeviceToken(token)
            lastRegisteredToken = nil
        } catch {
            #if DEBUG
            print("PushNotificationManager: Failed to unregister token: \(error)")
            #endif
        }
    }

    func handleSilentNotification(userInfo: [AnyHashable: Any]) async -> Bool {
        guard isAuthenticated else { return false }
        guard let aps = userInfo["aps"] as? [String: Any],
              aps["content-available"] as? Int == 1 else {
            return false
        }

        do {
            _ = try await ConvexService.shared.refreshPapersOnce()
            return true
        } catch {
            #if DEBUG
            print("PushNotificationManager: Background refresh failed: \(error)")
            #endif
            return false
        }
    }

    private func registerTokenIfPossible() async {
        guard isAuthenticated else { return }
        guard let token = deviceToken else { return }

        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            return
        }

        if token == lastRegisteredToken {
            return
        }

        do {
            let deviceId = UIDevice.current.identifierForVendor?.uuidString
            let appVersion = Bundle.main.appVersionString
            try await ConvexService.shared.registerDeviceToken(
                token,
                platform: "ios",
                environment: apnsEnvironment,
                deviceId: deviceId,
                appVersion: appVersion
            )
            lastRegisteredToken = token
        } catch {
            #if DEBUG
            print("PushNotificationManager: Failed to register token: \(error)")
            #endif
        }
    }
}
