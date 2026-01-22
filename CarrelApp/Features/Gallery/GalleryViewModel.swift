import Foundation
import SwiftUI

@Observable
@MainActor
final class GalleryViewModel {
    private(set) var papers: [Paper] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var isRefreshing = false

    private let authManager: AuthManager
    private var client: ConvexClient {
        ConvexClient(baseURL: AuthManager.baseURL, authManager: authManager)
    }

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    func loadPapers() async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        do {
            papers = try await client.papers()
        } catch let apiError as APIError {
            error = apiError.localizedDescription
            if apiError.isAuthError {
                // Force re-authentication
                await authManager.logout()
            }
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refresh() async {
        isRefreshing = true
        await loadPapers()
        isRefreshing = false
    }

    func buildPaper(_ paper: Paper, force: Bool = false) async {
        do {
            try await client.buildPaper(id: paper.id, force: force)
            // Reload to get updated status
            await loadPapers()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deletePaper(_ paper: Paper) async {
        do {
            try await client.deletePaper(id: paper.id)
            papers.removeAll { $0.id == paper.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearError() {
        error = nil
    }
}
