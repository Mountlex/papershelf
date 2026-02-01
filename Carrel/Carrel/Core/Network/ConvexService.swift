import Foundation
import ConvexMobile
import Combine

/// Custom AuthProvider that uses pre-obtained Convex Auth JWT tokens
/// This allows us to use tokens obtained from the web OAuth flow
final class ConvexAuthTokenProvider: AuthProvider {
    /// The current JWT token
    private var currentToken: String?

    /// Set the token (called when we receive it from OAuth)
    func setToken(_ token: String?) {
        currentToken = token
    }

    /// Login using the stored token
    func login() async throws -> String {
        guard let token = currentToken else {
            throw ConvexAuthError.noToken
        }
        return token
    }

    /// Login from cached token (same as login since we manage our own cache)
    func loginFromCache() async throws -> String {
        guard let token = currentToken else {
            throw ConvexAuthError.noToken
        }
        return token
    }

    /// Logout - just clear the token
    func logout() async throws {
        currentToken = nil
    }

    /// Extract the JWT ID token from our auth result (it's already the token)
    func extractIdToken(from authResult: String) -> String {
        return authResult
    }
}

enum ConvexAuthError: Error {
    case noToken
}

/// Main service for interacting with Convex backend using the official Swift SDK.
/// Provides real-time subscriptions and direct mutation/action calls.
@MainActor
final class ConvexService: ObservableObject {
    static let shared = ConvexService()

    /// The underlying Convex SDK client with auth support
    let client: ConvexClientWithAuth<String>

    /// The auth provider for managing tokens
    private let authProvider = ConvexAuthTokenProvider()

    /// Current authentication token
    @Published private(set) var authToken: String?

    /// Whether the user is currently authenticated
    @Published private(set) var isAuthenticated = false

    private var authStateCancellable: AnyCancellable?

    private var webSocketCancellable: AnyCancellable?

    private init() {
        // Initialize with the Convex deployment URL and our custom auth provider
        client = ConvexClientWithAuth(
            deploymentUrl: "https://kindhearted-bloodhound-95.convex.cloud",
            authProvider: authProvider
        )

        // Observe auth state changes from the client
        authStateCancellable = client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                print("ConvexService: Auth state changed to: \(state)")
                switch state {
                case .authenticated:
                    self?.isAuthenticated = true
                case .unauthenticated, .loading:
                    if case .unauthenticated = state {
                        self?.isAuthenticated = false
                    }
                @unknown default:
                    break
                }
            }

        // Monitor WebSocket connection state
        webSocketCancellable = client.watchWebSocketState()
            .receive(on: DispatchQueue.main)
            .sink { state in
                print("ConvexService: WebSocket state: \(state)")
            }
    }

    // MARK: - Authentication

    /// Set the authentication token received from the OAuth flow
    func setAuthToken(_ token: String?) async {
        print("ConvexService: setAuthToken called, token exists: \(token != nil)")
        authToken = token
        if let token = token {
            authProvider.setToken(token)
            // Trigger login to authenticate the client with the token
            do {
                try await client.login()
                print("ConvexService: Successfully authenticated with Convex")
            } catch {
                print("ConvexService: Failed to authenticate: \(error)")
            }
        } else {
            authProvider.setToken(nil)
            try? await client.logout()
        }
    }

    /// Clear authentication state
    func clearAuth() async {
        authToken = nil
        authProvider.setToken(nil)
        try? await client.logout()
        isAuthenticated = false
    }

    // MARK: - Papers

    /// Subscribe to the list of papers (real-time updates)
    func subscribeToPapers() -> AnyPublisher<[Paper], ClientError> {
        print("ConvexService: Creating subscription to papers:listMine")
        return client.subscribe(to: "papers:listMine", yielding: [Paper].self)
            .removeDuplicates()
            .eraseToAnyPublisher()
    }

    /// Get a single paper by ID (uses subscription to get one-time value)
    func getPaper(id: String) async throws -> Paper {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = client.subscribe(to: "papers:get", with: ["id": id], yielding: Paper.self)
                .first()
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            continuation.resume(throwing: error)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { paper in
                        continuation.resume(returning: paper)
                    }
                )
        }
    }

    /// Subscribe to a single paper for real-time updates
    func subscribeToPaper(id: String) -> AnyPublisher<Paper, ClientError> {
        client.subscribe(to: "papers:get", with: ["id": id], yielding: Paper.self)
            .eraseToAnyPublisher()
    }

    /// Build/sync a paper
    func buildPaper(id: String, force: Bool = false) async throws {
        // sync:buildPaper is an action that triggers paper compilation
        let _: EmptyResult? = try await client.action("sync:buildPaper", with: ["paperId": id, "force": force])
    }

    /// Delete a paper
    func deletePaper(id: String) async throws {
        // papers:deletePaper is the mutation to remove a paper
        let _: EmptyResult? = try await client.mutation("papers:deletePaper", with: ["id": id])
    }

    /// Update paper metadata
    func updatePaper(id: String, title: String?) async throws {
        var args: [String: String] = ["id": id]
        if let title = title {
            args["title"] = title
        }
        let _: EmptyResult? = try await client.mutation("papers:update", with: args)
    }

    /// Toggle paper public status
    func togglePaperPublic(id: String) async throws -> TogglePublicResult {
        try await client.mutation("papers:togglePublic", with: ["paperId": id])
    }

    // MARK: - User

    /// Get the current user's profile
    func getViewer() async throws -> User? {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = client.subscribe(to: "users:viewer", yielding: User?.self)
                .first()
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            continuation.resume(throwing: error)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { user in
                        continuation.resume(returning: user)
                    }
                )
        }
    }

    // MARK: - Sync Operations

    /// Check all repositories for updates
    func checkAllRepositories() async throws -> CheckAllResult {
        try await client.action("sync:refreshAllRepositories")
    }

    // MARK: - Repositories

    /// Subscribe to repositories list (requires userId from viewer)
    func subscribeToRepositories(userId: String) -> AnyPublisher<[Repository], ClientError> {
        client.subscribe(to: "repositories:list", with: ["userId": userId], yielding: [Repository].self)
            .removeDuplicates()
            .eraseToAnyPublisher()
    }

    /// Delete a repository (cascades to papers and tracked files)
    func deleteRepository(id: String) async throws {
        let _: EmptyResult? = try await client.mutation("repositories:remove", with: ["id": id])
    }

    /// Refresh a single repository
    func refreshRepository(id: String) async throws -> RefreshRepositoryResult {
        try await client.action("sync:refreshRepository", with: ["repositoryId": id])
    }

    // MARK: - Repository Files

    /// List files in a repository directory
    func listRepositoryFiles(gitUrl: String, path: String?, branch: String?) async throws -> [RepositoryFile] {
        var args: [String: String] = ["gitUrl": gitUrl]
        if let path = path, !path.isEmpty {
            args["path"] = path
        }
        if let branch = branch {
            args["branch"] = branch
        }
        return try await client.action("git:listRepositoryFiles", with: args)
    }

    /// Add a tracked file and create paper
    func addTrackedFile(
        repositoryId: String,
        filePath: String,
        title: String,
        pdfSourceType: String,
        compiler: String?
    ) async throws -> AddTrackedFileResult {
        var args: [String: String] = [
            "repositoryId": repositoryId,
            "filePath": filePath,
            "title": title,
            "pdfSourceType": pdfSourceType
        ]
        if let compiler = compiler {
            args["compiler"] = compiler
        }
        return try await client.mutation("papers:addTrackedFile", with: args)
    }

    /// List tracked files for a repository
    func listTrackedFiles(repositoryId: String) async throws -> [TrackedFileInfo] {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = client.subscribe(to: "papers:listTrackedFiles", with: ["repositoryId": repositoryId], yielding: [TrackedFileInfo].self)
                .first()
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            continuation.resume(throwing: error)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { files in
                        continuation.resume(returning: files)
                    }
                )
        }
    }
}

// MARK: - Result Types

/// Empty result for mutations that don't return meaningful data
struct EmptyResult: Codable {}

struct TogglePublicResult: Codable {
    let isPublic: Bool
    let shareSlug: String?
}

struct CheckAllResult: Codable {
    let checked: Int
    let updated: Int
    let failed: Int
}

struct RefreshRepositoryResult: Codable {
    let updated: Bool
    let dateIsFallback: Bool?
    let skipped: Bool?
    let reason: String?
    let commitHash: String?
}

struct AddTrackedFileResult: Codable {
    let trackedFileId: String
    let paperId: String
}

struct TrackedFileInfo: Codable, Identifiable {
    let id: String
    let filePath: String

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case filePath
    }
}
