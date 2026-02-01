import Combine
import Foundation
import SwiftUI

@Observable
@MainActor
final class RepositoryViewModel {
    private(set) var repositories: [Repository] = []
    private(set) var isLoading = false
    private(set) var error: String?

    /// ID of the repository currently being refreshed
    private(set) var refreshingRepoId: String?

    /// Whether a "Check All" operation is in progress
    private(set) var isCheckingAll = false

    /// Current toast message to display
    var toastMessage: ToastMessage?

    private var subscriptionTask: Task<Void, Never>?

    // MARK: - Subscription Lifecycle

    /// Start subscribing to repositories via Convex SDK for real-time updates
    func startSubscription() {
        // Cancel any existing subscription
        stopSubscription()

        print("RepositoryViewModel: Starting repositories subscription...")
        print("RepositoryViewModel: ConvexService isAuthenticated = \(ConvexService.shared.isAuthenticated)")

        // Set loading state until first subscription update
        isLoading = true

        subscriptionTask = Task {
            do {
                // First get the current user to get their userId
                guard let user = try await ConvexService.shared.getViewer() else {
                    await MainActor.run {
                        self.error = "Not authenticated"
                        self.isLoading = false
                    }
                    return
                }

                print("RepositoryViewModel: Got user ID: \(user.id)")

                let repositoriesPublisher = ConvexService.shared.subscribeToRepositories(userId: user.id)

                for try await latestRepositories in repositoriesPublisher.values {
                    await MainActor.run {
                        // Only log if count changed
                        if self.repositories.count != latestRepositories.count {
                            print("RepositoryViewModel: Repositories count changed: \(self.repositories.count) -> \(latestRepositories.count)")
                        }
                        self.repositories = latestRepositories
                        if self.isLoading {
                            self.isLoading = false
                        }
                    }
                }
                print("RepositoryViewModel: Subscription loop ended normally")
            } catch {
                print("RepositoryViewModel: Subscription error: \(error)")
                await MainActor.run {
                    self.error = error.localizedDescription
                    self.isLoading = false
                }
            }
        }
    }

    /// Stop the repositories subscription
    func stopSubscription() {
        subscriptionTask?.cancel()
        subscriptionTask = nil
    }

    // MARK: - Check All Repositories

    /// Check all repositories for updates
    func checkAllRepositories() async {
        guard !isCheckingAll else { return }

        isCheckingAll = true
        defer { isCheckingAll = false }

        do {
            let result = try await ConvexService.shared.checkAllRepositories()

            if result.failed > 0 {
                toastMessage = ToastMessage(text: "\(result.failed) repos failed", type: .error)
            } else if result.checked == 0 {
                toastMessage = ToastMessage(text: "All repos recently checked", type: .info)
            } else if result.updated > 0 {
                toastMessage = ToastMessage(text: "\(result.updated) repos updated", type: .success)
            } else {
                toastMessage = ToastMessage(text: "All repos up to date", type: .info)
            }
        } catch {
            toastMessage = ToastMessage(text: "Failed to check repos", type: .error)
        }
    }

    // MARK: - Repository Operations

    /// Refresh a single repository
    func refreshRepository(_ repository: Repository) async {
        guard refreshingRepoId == nil else { return }

        refreshingRepoId = repository.id
        defer { refreshingRepoId = nil }

        do {
            let result = try await ConvexService.shared.refreshRepository(id: repository.id)

            if result.skipped == true {
                toastMessage = ToastMessage(text: "Already syncing", type: .info)
            } else if result.updated {
                toastMessage = ToastMessage(text: "Repository updated", type: .success)
            } else {
                toastMessage = ToastMessage(text: "Already up to date", type: .info)
            }
        } catch {
            let message = error.localizedDescription.contains("Rate limit")
                ? "Rate limited, try later"
                : "Failed to refresh"
            toastMessage = ToastMessage(text: message, type: .error)
        }
    }

    /// Delete a repository (cascades to papers and tracked files)
    func deleteRepository(_ repository: Repository) async {
        do {
            try await ConvexService.shared.deleteRepository(id: repository.id)
            // With subscriptions, the repository list will update automatically
            toastMessage = ToastMessage(text: "Repository deleted", type: .success)
        } catch {
            self.error = error.localizedDescription
            toastMessage = ToastMessage(text: "Failed to delete", type: .error)
        }
    }

    func clearError() {
        error = nil
    }

    func clearToast() {
        toastMessage = nil
    }
}
