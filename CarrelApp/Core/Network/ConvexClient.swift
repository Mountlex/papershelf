import Foundation

actor ConvexClient {
    private let baseURL: URL
    private let authManager: AuthManager
    private let session: URLSession
    private let decoder: JSONDecoder

    init(baseURL: URL, authManager: AuthManager) {
        self.baseURL = baseURL
        self.authManager = authManager

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
    }

    // MARK: - Papers

    func papers() async throws -> [Paper] {
        let data: [Paper] = try await request(.get, "/api/mobile/papers")
        return data
    }

    func paper(id: String) async throws -> Paper {
        try await request(.get, "/api/mobile/paper", query: ["id": id])
    }

    func buildPaper(id: String, force: Bool = false) async throws {
        let _: EmptyResponse = try await request(
            .post,
            "/api/mobile/paper/build",
            body: ["paperId": id, "force": force]
        )
    }

    func deletePaper(id: String) async throws {
        let _: EmptyResponse = try await request(
            .delete,
            "/api/mobile/paper",
            body: ["paperId": id]
        )
    }

    func updatePaper(id: String, title: String?, authors: String?) async throws {
        var body: [String: Any] = ["paperId": id]
        if let title = title {
            body["title"] = title
        }
        if let authors = authors {
            body["authors"] = authors
        }
        let _: EmptyResponse = try await request(.patch, "/api/mobile/paper", body: body)
    }

    func togglePaperPublic(id: String) async throws -> TogglePublicResponse {
        try await request(
            .post,
            "/api/mobile/paper/toggle-public",
            body: ["paperId": id]
        )
    }

    // MARK: - User

    func user() async throws -> User {
        try await request(.get, "/api/mobile/user")
    }

    // MARK: - Auth

    func refreshToken(_ refreshToken: String) async throws -> RefreshTokenResponse {
        try await requestWithoutAuth(
            .post,
            "/api/mobile/refresh",
            body: ["refreshToken": refreshToken]
        )
    }

    func revokeToken(_ refreshToken: String) async throws {
        let _: EmptyResponse = try await requestWithoutAuth(
            .post,
            "/api/mobile/revoke",
            body: ["refreshToken": refreshToken]
        )
    }

    // MARK: - Private

    private func request<T: Decodable>(
        _ method: HTTPMethod,
        _ path: String,
        query: [String: String]? = nil,
        body: [String: Any]? = nil
    ) async throws -> T {
        let token = try await authManager.getValidToken()
        return try await performRequest(method, path, query: query, body: body, token: token)
    }

    private func requestWithoutAuth<T: Decodable>(
        _ method: HTTPMethod,
        _ path: String,
        query: [String: String]? = nil,
        body: [String: Any]? = nil
    ) async throws -> T {
        try await performRequest(method, path, query: query, body: body, token: nil)
    }

    private func performRequest<T: Decodable>(
        _ method: HTTPMethod,
        _ path: String,
        query: [String: String]?,
        body: [String: Any]?,
        token: String?
    ) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: true)

        if let query = query {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        guard let url = components?.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue

        if let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.unknown(0, "Invalid response type")
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }

        case 401:
            // Try to parse error message
            if let errorResponse = try? decoder.decode(APIErrorResponse.self, from: data) {
                if errorResponse.error.contains("expired") {
                    throw APIError.tokenExpired
                }
            }
            throw APIError.unauthorized

        case 404:
            throw APIError.notFound

        case 400:
            let message = (try? decoder.decode(APIErrorResponse.self, from: data))?.error ?? "Bad request"
            throw APIError.badRequest(message)

        case 500...599:
            let message = (try? decoder.decode(APIErrorResponse.self, from: data))?.error ?? "Server error"
            throw APIError.serverError(message)

        default:
            let message = (try? decoder.decode(APIErrorResponse.self, from: data))?.error
            throw APIError.unknown(httpResponse.statusCode, message)
        }
    }
}

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct EmptyResponse: Codable {
    let success: Bool?
}

struct TogglePublicResponse: Codable {
    let isPublic: Bool
    let shareSlug: String?
}
