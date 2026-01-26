import Foundation
import SwiftUI

@Observable
@MainActor
final class PaperViewModel {
    private(set) var paper: Paper
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var isBuilding = false
    private(set) var isTogglingPublic = false

    private let authManager: AuthManager
    private var client: ConvexClient {
        ConvexClient(baseURL: AuthManager.baseURL, authManager: authManager)
    }
    private var pollingTask: Task<Void, Never>?

    init(paper: Paper, authManager: AuthManager) {
        self.paper = paper
        self.authManager = authManager
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        do {
            paper = try await client.paper(id: paper.id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func build(force: Bool = false) async {
        isBuilding = true

        // Start polling for progress updates
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds
                if Task.isCancelled { break }
                do {
                    let updatedPaper = try await client.paper(id: paper.id)
                    await MainActor.run {
                        paper = updatedPaper
                    }
                    // Stop polling if build completed (no longer building and no progress)
                    if updatedPaper.compilationProgress == nil && updatedPaper.status != .building {
                        break
                    }
                } catch {
                    // Ignore polling errors
                }
            }
        }

        do {
            try await client.buildPaper(id: paper.id, force: force)
        } catch {
            self.error = error.localizedDescription
        }

        // Stop polling and do final refresh
        pollingTask?.cancel()
        pollingTask = nil
        await refresh()
        isBuilding = false
    }

    func updateMetadata(title: String?, authors: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await client.updatePaper(id: paper.id, title: title, authors: authors)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func togglePublic() async {
        isTogglingPublic = true
        defer { isTogglingPublic = false }

        do {
            let result = try await client.togglePaperPublic(id: paper.id)
            await refresh()
            _ = result // We refresh to get the full updated paper
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearError() {
        error = nil
    }
}
