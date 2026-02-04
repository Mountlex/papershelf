import Foundation

struct NotificationPreferences: Codable, Equatable {
    var enabled: Bool
    var buildSuccess: Bool
    var buildFailure: Bool
    var paperUpdated: Bool
    var backgroundSync: Bool

    static let `default` = NotificationPreferences(
        enabled: true,
        buildSuccess: true,
        buildFailure: true,
        paperUpdated: true,
        backgroundSync: true
    )
}
