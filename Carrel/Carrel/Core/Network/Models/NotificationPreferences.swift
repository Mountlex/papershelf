import Foundation

struct NotificationPreferences: Codable, Equatable {
    var enabled: Bool
    var buildSuccess: Bool
    var buildFailure: Bool
    var paperUpdated: Bool
    var backgroundSync: Bool
    var updateCooldownMinutes: Int

    enum CodingKeys: String, CodingKey {
        case enabled
        case buildSuccess
        case buildFailure
        case paperUpdated
        case backgroundSync
        case updateCooldownMinutes
    }

    static let `default` = NotificationPreferences(
        enabled: true,
        buildSuccess: true,
        buildFailure: true,
        paperUpdated: true,
        backgroundSync: true,
        updateCooldownMinutes: 30
    )

    init(
        enabled: Bool,
        buildSuccess: Bool,
        buildFailure: Bool,
        paperUpdated: Bool,
        backgroundSync: Bool,
        updateCooldownMinutes: Int
    ) {
        self.enabled = enabled
        self.buildSuccess = buildSuccess
        self.buildFailure = buildFailure
        self.paperUpdated = paperUpdated
        self.backgroundSync = backgroundSync
        self.updateCooldownMinutes = updateCooldownMinutes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decode(Bool.self, forKey: .enabled)
        buildSuccess = try container.decode(Bool.self, forKey: .buildSuccess)
        buildFailure = try container.decode(Bool.self, forKey: .buildFailure)
        paperUpdated = try container.decode(Bool.self, forKey: .paperUpdated)
        backgroundSync = try container.decode(Bool.self, forKey: .backgroundSync)
        updateCooldownMinutes = try container.decodeIfPresent(Int.self, forKey: .updateCooldownMinutes) ?? 30
    }
}
