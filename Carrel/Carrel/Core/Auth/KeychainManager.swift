import Foundation
import Security

actor KeychainManager {
    static let shared = KeychainManager()

    private let service = "com.carrel.app"

    private enum Keys {
        static let convexAuthToken = "convex_auth_token"
        static let refreshToken = "refresh_token"
    }

    private init() {}

    // MARK: - Convex Auth Token

    func saveConvexAuthToken(_ token: String) throws {
        guard let data = token.data(using: .utf8) else {
            throw KeychainError.saveFailed(errSecParam)
        }
        try save(key: Keys.convexAuthToken, data: data)
    }

    func loadConvexAuthToken() -> String? {
        guard let data = load(key: Keys.convexAuthToken),
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    func clearConvexAuthToken() {
        delete(key: Keys.convexAuthToken)
    }

    // MARK: - Refresh Token

    func saveRefreshToken(_ token: String) throws {
        guard let data = token.data(using: .utf8) else {
            throw KeychainError.saveFailed(errSecParam)
        }
        try save(key: Keys.refreshToken, data: data)
    }

    func loadRefreshToken() -> String? {
        guard let data = load(key: Keys.refreshToken),
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    func clearRefreshToken() {
        delete(key: Keys.refreshToken)
    }

    func clearAllTokens() {
        clearConvexAuthToken()
        clearRefreshToken()
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

    @discardableResult
    private func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        // Success if deleted or item didn't exist
        return status == errSecSuccess || status == errSecItemNotFound
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
