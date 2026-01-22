import Foundation
import Security

actor KeychainManager {
    static let shared = KeychainManager()

    private let service = "com.carrel.app"

    private enum Keys {
        static let accessToken = "access_token"
        static let refreshToken = "refresh_token"
        static let accessTokenExpiry = "access_token_expiry"
        static let refreshTokenExpiry = "refresh_token_expiry"
    }

    private init() {}

    // MARK: - Token Storage

    func saveTokens(_ tokens: AuthTokens) throws {
        try save(key: Keys.accessToken, data: tokens.accessToken.data(using: .utf8)!)
        try save(key: Keys.accessTokenExpiry, data: String(tokens.expiresAt.timeIntervalSince1970).data(using: .utf8)!)

        if let refreshToken = tokens.refreshToken {
            try save(key: Keys.refreshToken, data: refreshToken.data(using: .utf8)!)
        }

        if let refreshExpiry = tokens.refreshExpiresAt {
            try save(key: Keys.refreshTokenExpiry, data: String(refreshExpiry.timeIntervalSince1970).data(using: .utf8)!)
        }
    }

    func loadTokens() -> StoredTokens? {
        guard let accessTokenData = load(key: Keys.accessToken),
              let accessToken = String(data: accessTokenData, encoding: .utf8),
              let expiryData = load(key: Keys.accessTokenExpiry),
              let expiryString = String(data: expiryData, encoding: .utf8),
              let expiryInterval = TimeInterval(expiryString) else {
            return nil
        }

        let refreshToken: String?
        if let refreshData = load(key: Keys.refreshToken) {
            refreshToken = String(data: refreshData, encoding: .utf8)
        } else {
            refreshToken = nil
        }

        let refreshExpiry: Date?
        if let refreshExpiryData = load(key: Keys.refreshTokenExpiry),
           let refreshExpiryString = String(data: refreshExpiryData, encoding: .utf8),
           let refreshExpiryInterval = TimeInterval(refreshExpiryString) {
            refreshExpiry = Date(timeIntervalSince1970: refreshExpiryInterval)
        } else {
            refreshExpiry = nil
        }

        return StoredTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            accessTokenExpiry: Date(timeIntervalSince1970: expiryInterval),
            refreshTokenExpiry: refreshExpiry
        )
    }

    func clearTokens() {
        delete(key: Keys.accessToken)
        delete(key: Keys.refreshToken)
        delete(key: Keys.accessTokenExpiry)
        delete(key: Keys.refreshTokenExpiry)
    }

    // MARK: - Generic Keychain Operations

    private func save(key: String, data: Data) throws {
        // Delete existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    private func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            return nil
        }

        return result as? Data
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)
    }
}

struct StoredTokens {
    let accessToken: String
    let refreshToken: String?
    let accessTokenExpiry: Date
    let refreshTokenExpiry: Date?

    var isAccessTokenValid: Bool {
        accessTokenExpiry > Date().addingTimeInterval(60) // 1 minute buffer
    }

    var isRefreshTokenValid: Bool {
        guard let refreshExpiry = refreshTokenExpiry else { return false }
        return refreshExpiry > Date().addingTimeInterval(60)
    }
}

enum KeychainError: Error, LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Failed to save to Keychain: \(status)"
        case .loadFailed(let status):
            return "Failed to load from Keychain: \(status)"
        }
    }
}
