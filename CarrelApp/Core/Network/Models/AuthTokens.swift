import Foundation

struct AuthTokens: Codable {
    let accessToken: String
    let refreshToken: String?
    let expiresAt: Date
    let refreshExpiresAt: Date?
    let tokenType: String

    enum CodingKeys: String, CodingKey {
        case accessToken, refreshToken, expiresAt, refreshExpiresAt, tokenType
    }

    init(accessToken: String, refreshToken: String?, expiresAt: Date, refreshExpiresAt: Date?, tokenType: String = "Bearer") {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.refreshExpiresAt = refreshExpiresAt
        self.tokenType = tokenType
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        accessToken = try container.decode(String.self, forKey: .accessToken)
        refreshToken = try container.decodeIfPresent(String.self, forKey: .refreshToken)
        tokenType = try container.decodeIfPresent(String.self, forKey: .tokenType) ?? "Bearer"

        // Parse timestamps (Convex sends milliseconds)
        let expiresAtMs = try container.decode(Double.self, forKey: .expiresAt)
        expiresAt = Date(timeIntervalSince1970: expiresAtMs / 1000)

        if let refreshExpiresAtMs = try container.decodeIfPresent(Double.self, forKey: .refreshExpiresAt) {
            refreshExpiresAt = Date(timeIntervalSince1970: refreshExpiresAtMs / 1000)
        } else {
            refreshExpiresAt = nil
        }
    }
}

struct RefreshTokenResponse: Codable {
    let accessToken: String
    let expiresAt: Date
    let tokenType: String

    enum CodingKeys: String, CodingKey {
        case accessToken, expiresAt, tokenType
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        accessToken = try container.decode(String.self, forKey: .accessToken)
        tokenType = try container.decodeIfPresent(String.self, forKey: .tokenType) ?? "Bearer"

        let expiresAtMs = try container.decode(Double.self, forKey: .expiresAt)
        expiresAt = Date(timeIntervalSince1970: expiresAtMs / 1000)
    }
}
