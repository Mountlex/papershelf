import Combine
import Foundation
import SwiftUI

@Observable
@MainActor
final class GalleryViewModel: SubscribableViewModel {
    typealias SubscriptionData = [Paper]

    private(set) var papers: [Paper] = []
    var isLoading = false
    var error: String?
    var subscriptionTask: Task<Void, Never>?
    var subscriptionStoppedAt: Date?

    init() {
        #if DEBUG
        print("GalleryViewModel: init called")
        #endif
    }

    /// Whether a "Check All Repositories" sync is in progress
    private(set) var isSyncing = false

    /// Whether a "Refresh All Papers" operation is in progress
    private(set) var isRefreshingAll = false

    /// Progress of the "Refresh All" operation (current, total)
    private(set) var refreshProgress: (current: Int, total: Int)?

    /// ID of the paper currently being synced
    private(set) var syncingPaperId: String?

    /// Current toast message to display
    var toastMessage: ToastMessage?

    // MARK: - SubscribableViewModel

    func createSubscriptionPublisher() -> AnyPublisher<[Paper], Error> {
        #if DEBUG
        print("GalleryViewModel: Starting papers subscription...")
        print("GalleryViewModel: ConvexService isAuthenticated = \(ConvexService.shared.isAuthenticated)")
        #endif
        return ConvexService.shared.subscribeToPapers()
            .mapError { $0 as Error }
            .eraseToAnyPublisher()
    }

    func handleSubscriptionData(_ data: [Paper]) {
        #if DEBUG
        print("GalleryViewModel: Received \(data.count) papers")
        #endif
        papers = data
    }

    // MARK: - Check All Repositories

    /// Check all repositories for updates (equivalent to web app's "Check All")
    func checkAllRepositories() async {
        guard !isSyncing else { return }

        isSyncing = true
        defer { isSyncing = false }

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

    // MARK: - Refresh All Papers

    /// Refresh all papers that need sync (equivalent to web app's "Refresh All")
    func refreshAllPapers() async {
        let outdated = papers.filter { $0.isUpToDate == false && $0.buildStatus != "building" }

        guard !outdated.isEmpty else {
            toastMessage = ToastMessage(text: "All papers up to date", type: .info)
            return
        }

        isRefreshingAll = true
        refreshProgress = (0, outdated.count)

        var successCount = 0
        var failCount = 0

        for (index, paper) in outdated.enumerated() {
            do {
                try await ConvexService.shared.buildPaper(id: paper.id, force: false)
                successCount += 1
            } catch {
                failCount += 1
            }
            refreshProgress = (index + 1, outdated.count)
        }

        isRefreshingAll = false
        refreshProgress = nil

        if failCount > 0 {
            toastMessage = ToastMessage(text: "Refreshed \(successCount), \(failCount) failed", type: .error)
        } else {
            toastMessage = ToastMessage(text: "Refreshed \(successCount) papers", type: .success)
        }
    }

    // MARK: - Paper Operations

    func buildPaper(_ paper: Paper, force: Bool = false) async {
        syncingPaperId = paper.id
        defer { syncingPaperId = nil }

        do {
            try await ConvexService.shared.buildPaper(id: paper.id, force: force)
            // With subscriptions, the paper list will update automatically
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deletePaper(_ paper: Paper) async {
        do {
            try await ConvexService.shared.deletePaper(id: paper.id)
            papers.removeAll { $0.id == paper.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearError() {
        error = nil
    }

    func clearToast() {
        toastMessage = nil
    }
}
