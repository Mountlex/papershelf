import Foundation
import SwiftUI
import Combine

@Observable
@MainActor
final class PaperViewModel {
    private(set) var paper: Paper
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var isBuilding = false
    private(set) var isTogglingPublic = false

    private var buildSubscription: AnyCancellable?

    init(paper: Paper) {
        self.paper = paper
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        do {
            paper = try await ConvexService.shared.getPaper(id: paper.id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func build(force: Bool = false) async {
        isBuilding = true

        // Trigger the build using ConvexService
        do {
            try await ConvexService.shared.buildPaper(id: paper.id, force: force)
        } catch {
            self.error = error.localizedDescription
            isBuilding = false
            return
        }

        // Subscribe for real-time updates instead of polling
        let paperId = paper.id
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            buildSubscription = ConvexService.shared.subscribeToPaper(id: paperId)
                .receive(on: DispatchQueue.main)
                .sink(
                    receiveCompletion: { [weak self] completion in
                        if case .failure(let error) = completion {
                            print("PaperViewModel: Subscription error: \(error)")
                            self?.error = error.localizedDescription
                        }
                        self?.buildSubscription = nil
                        self?.isBuilding = false
                        continuation.resume()
                    },
                    receiveValue: { [weak self] updatedPaper in
                        guard let self = self else { return }
                        self.paper = updatedPaper
                        print("PaperViewModel: Update received - buildStatus=\(updatedPaper.buildStatus ?? "nil"), progress=\(updatedPaper.compilationProgress ?? "nil")")

                        // Check if build completed
                        if updatedPaper.buildStatus != "building" && updatedPaper.compilationProgress == nil {
                            self.buildSubscription?.cancel()
                            self.buildSubscription = nil
                            self.isBuilding = false

                            // Trigger haptic based on final status
                            print("PaperViewModel: Build finished, status=\(updatedPaper.status), isUpToDate=\(String(describing: updatedPaper.isUpToDate)), buildStatus=\(String(describing: updatedPaper.buildStatus))")
                            switch updatedPaper.status {
                            case .synced:
                                print("PaperViewModel: Triggering success haptic")
                                HapticManager.buildSuccess()
                            case .error:
                                print("PaperViewModel: Triggering error haptic")
                                HapticManager.buildError()
                            default:
                                print("PaperViewModel: No haptic for status \(updatedPaper.status)")
                            }

                            continuation.resume()
                        }
                    }
                )
        }
    }

    func updateMetadata(title: String?, authors: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await ConvexService.shared.updatePaper(id: paper.id, title: title, authors: authors)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func togglePublic() async {
        isTogglingPublic = true
        defer { isTogglingPublic = false }

        do {
            _ = try await ConvexService.shared.togglePaperPublic(id: paper.id)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearError() {
        error = nil
    }
}
