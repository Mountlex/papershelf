import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case unauthorized
    case notFound
    case badRequest(String)
    case serverError(String)
    case networkError(Error)
    case decodingError(Error)
    case tokenExpired
    case unknown(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .unauthorized:
            return "You are not authorized. Please sign in again."
        case .notFound:
            return "Resource not found"
        case .badRequest(let message):
            return "Bad request: \(message)"
        case .serverError(let message):
            return "Server error: \(message)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Failed to parse response: \(error.localizedDescription)"
        case .tokenExpired:
            return "Session expired. Please sign in again."
        case .unknown(let code, let message):
            return "Error \(code): \(message ?? "Unknown error")"
        }
    }

    var isAuthError: Bool {
        switch self {
        case .unauthorized, .tokenExpired:
            return true
        default:
            return false
        }
    }
}

struct APIErrorResponse: Codable {
    let error: String
}
