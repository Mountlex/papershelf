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

    /// Convex deployment URL from Info.plist (with fallback)
    private static var deploymentURL: String {
        Bundle.main.object(forInfoDictionaryKey: "ConvexDeploymentURL") as? String
            ?? "https://kindhearted-bloodhound-95.convex.cloud"
    }

    private init() {
        // Initialize with the Convex deployment URL and our custom auth provider
        client = ConvexClientWithAuth(
            deploymentUrl: Self.deploymentURL,
            authProvider: authProvider
        )

        // Observe auth state changes from the client
        authStateCancellable = client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                #if DEBUG
                print("ConvexService: Auth state changed to: \(state)")
                #endif
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

        // Monitor WebSocket connection state (only log on state changes)
        var lastState: String?
        webSocketCancellable = client.watchWebSocketState()
            .receive(on: DispatchQueue.main)
            .sink { state in
                #if DEBUG
                let stateStr = "\(state)"
                if stateStr != lastState {
                    print("ConvexService: WebSocket state: \(state)")
                    lastState = stateStr
                }
                #endif
            }
    }

    // MARK: - Authentication

    /// Set the authentication token received from the OAuth flow
    /// - Returns: `true` if authentication succeeded, `false` if it failed
    @discardableResult
    func setAuthToken(_ token: String?) async -> Bool {
        #if DEBUG
        print("ConvexService: setAuthToken called, token exists: \(token != nil)")
        #endif
        authToken = token
        if let token = token {
            authProvider.setToken(token)
            // Trigger login to authenticate the client with the token
            do {
                try await client.login()
                #if DEBUG
                print("ConvexService: client.login() completed, isAuthenticated = \(isAuthenticated)")
                #endif

                // Auth state is updated via the authState publisher observer
                // If not yet authenticated, wait for the auth state to change (with timeout)
                if !isAuthenticated {
                    let authenticated = await waitForAuthentication(timeout: 5.0)
                    if !authenticated {
                        #if DEBUG
                        print("ConvexService: Auth state did not become authenticated")
                        #endif
                        authToken = nil
                        authProvider.setToken(nil)
                        return false
                    }
                }

                #if DEBUG
                print("ConvexService: Successfully authenticated with Convex")
                #endif
                return true
            } catch {
                #if DEBUG
                print("ConvexService: Failed to authenticate: \(error)")
                #endif
                // Clear the invalid token
                authToken = nil
                authProvider.setToken(nil)
                return false
            }
        } else {
            authProvider.setToken(nil)
            try? await client.logout()
            return false
        }
    }

    /// Wait for authentication state to become authenticated
    /// - Parameter timeout: Maximum time to wait in seconds
    /// - Returns: `true` if authenticated within timeout, `false` otherwise
    private func waitForAuthentication(timeout: TimeInterval) async -> Bool {
        // Check current state first
        if isAuthenticated { return true }

        // Use a simple polling approach with exponential backoff
        // This is more reliable than complex Combine continuations
        let checkIntervals: [UInt64] = [50, 100, 200, 500, 1000] // milliseconds
        var totalWaited: UInt64 = 0
        let timeoutMs = UInt64(timeout * 1000)

        for interval in checkIntervals {
            if totalWaited >= timeoutMs { break }

            try? await Task.sleep(for: .milliseconds(interval))
            totalWaited += interval

            if isAuthenticated {
                #if DEBUG
                print("ConvexService: Authentication confirmed after \(totalWaited)ms")
                #endif
                return true
            }
        }

        // Continue with 1 second intervals until timeout
        while totalWaited < timeoutMs {
            try? await Task.sleep(for: .seconds(1))
            totalWaited += 1000

            if isAuthenticated {
                #if DEBUG
                print("ConvexService: Authentication confirmed after \(totalWaited)ms")
                #endif
                return true
            }
        }

        return false
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
        #if DEBUG
        print("ConvexService: Creating subscription to papers:listMine")
        #endif
        return client.subscribe(to: "papers:listMine", yielding: [Paper].self)
            .eraseToAnyPublisher()
    }

    /// Fetch papers once (used for background refresh)
    func refreshPapersOnce() async throws -> [Paper] {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = client.subscribe(to: "papers:listMine", yielding: [Paper].self)
                .first()
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            continuation.resume(throwing: error)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { papers in
                        continuation.resume(returning: papers)
                    }
                )
        }
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

    // MARK: - Notifications

    /// Fetch notification preferences for the current user
    func getNotificationPreferences() async throws -> NotificationPreferences {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = client.subscribe(to: "notifications:getNotificationPreferences", yielding: NotificationPreferences.self)
                .first()
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            continuation.resume(throwing: error)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { preferences in
                        continuation.resume(returning: preferences)
                    }
                )
        }
    }

    /// Update notification preferences for the current user
    func updateNotificationPreferences(_ preferences: NotificationPreferences) async throws {
        let _: EmptyResult? = try await client.mutation(
            "notifications:updateNotificationPreferences",
            with: [
                "enabled": preferences.enabled,
                "buildSuccess": preferences.buildSuccess,
                "buildFailure": preferences.buildFailure,
                "paperUpdated": preferences.paperUpdated,
                "backgroundSync": preferences.backgroundSync,
                "updateCooldownMinutes": Double(preferences.updateCooldownMinutes),
            ]
        )
    }

    /// Register device token for push notifications
    func registerDeviceToken(
        _ token: String,
        platform: String = "ios",
        environment: String,
        deviceId: String?,
        appVersion: String?
    ) async throws {
        var args: [String: String] = [
            "token": token,
            "platform": platform,
            "environment": environment,
        ]
        if let deviceId {
            args["deviceId"] = deviceId
        }
        if let appVersion {
            args["appVersion"] = appVersion
        }
        let _: EmptyResult? = try await client.mutation(
            "notifications:registerDeviceToken",
            with: args
        )
    }

    /// Unregister device token for push notifications
    func unregisterDeviceToken(_ token: String) async throws {
        let _: EmptyResult? = try await client.mutation(
            "notifications:unregisterDeviceToken",
            with: [
                "token": token,
            ]
        )
    }

    /// Send a test push notification to the current user
    func sendTestNotification() async throws -> TestNotificationResult {
        try await client.action("notifications:sendTestNotification")
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

    /// Update background refresh setting for a repository
    func setBackgroundRefresh(repositoryId: String, enabled: Bool) async throws {
        let _: EmptyResult? = try await client.mutation(
            "repositories:update",
            with: [
                "id": repositoryId,
                "backgroundRefreshEnabled": enabled,
            ]
        )
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

struct TestNotificationResult: Codable {
    let delivered: Int
    let reason: String?
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
