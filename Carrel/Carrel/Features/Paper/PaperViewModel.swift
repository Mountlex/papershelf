import Foundation
import SwiftUI

@Observable
@MainActor
final class PaperViewModel {
    var paper: Paper
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var isBuilding = false
    private(set) var isTogglingPublic = false
    private var buildTimeoutTask: Task<Void, Never>?

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
        buildTimeoutTask?.cancel()
        buildTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            await MainActor.run {
                guard let self else { return }
                if self.isBuilding && self.paper.buildStatus != "building" {
                    self.isBuilding = false
                }
            }
        }

        do {
            try await ConvexService.shared.buildPaper(id: paper.id, force: force)
        } catch {
            self.error = error.localizedDescription
            isBuilding = false
            buildTimeoutTask?.cancel()
            buildTimeoutTask = nil
        }
        // Note: isBuilding will be set to false by the subscription in the view
    }

    func onPaperUpdate(_ updatedPaper: Paper) {
        paper = updatedPaper
        buildTimeoutTask?.cancel()
        buildTimeoutTask = nil

        // Check if build completed
        if updatedPaper.buildStatus != "building" && updatedPaper.compilationProgress == nil {
            if isBuilding {
                isBuilding = false

                // Trigger haptic based on final status
                switch updatedPaper.status {
                case .synced:
                    HapticManager.buildSuccess()
                case .error:
                    HapticManager.buildError()
                default:
                    break
                }
            }
        }
    }

    func updateMetadata(title: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await ConvexService.shared.updatePaper(id: paper.id, title: title)
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
