import Foundation
import SwiftUI

enum Compiler: String, CaseIterable, Identifiable {
    case pdflatex
    case xelatex
    case lualatex

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pdflatex: return "pdfLaTeX"
        case .xelatex: return "XeLaTeX"
        case .lualatex: return "LuaLaTeX"
        }
    }
}

@Observable
@MainActor
final class AddPaperFromRepoViewModel {
    let repository: Repository

    // File browser state
    private(set) var files: [RepositoryFile] = []
    private(set) var currentPath: String = ""
    private(set) var isLoadingFiles = false
    private(set) var loadError: String?

    // Tracked files (already added)
    private(set) var trackedFilePaths: Set<String> = []

    // Toast
    var toastMessage: ToastMessage?

    init(repository: Repository) {
        self.repository = repository
    }

    func isFileTracked(_ path: String) -> Bool {
        trackedFilePaths.contains(path)
    }

    // MARK: - Computed Properties

    var breadcrumbs: [String] {
        if currentPath.isEmpty {
            return []
        }
        return currentPath.components(separatedBy: "/")
    }

    // MARK: - File Browser

    func loadFiles(path: String? = nil) async {
        isLoadingFiles = true
        loadError = nil

        do {
            let loadPath = path ?? currentPath

            // Fetch files and tracked files in parallel
            async let filesTask = ConvexService.shared.listRepositoryFiles(
                gitUrl: repository.gitUrl,
                path: loadPath.isEmpty ? nil : loadPath,
                branch: repository.defaultBranch
            )
            async let trackedTask = ConvexService.shared.listTrackedFiles(repositoryId: repository.id)

            let (fetchedFiles, trackedFiles) = try await (filesTask, trackedTask)

            // Update tracked file paths
            trackedFilePaths = Set(trackedFiles.map { $0.filePath })

            // Sort: directories first, then files, alphabetically within each group
            files = fetchedFiles.sorted { lhs, rhs in
                if lhs.isDirectory != rhs.isDirectory {
                    return lhs.isDirectory
                }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }

            // Filter to show only directories and selectable files (.tex, .pdf)
            files = files.filter { $0.isDirectory || $0.isSelectable }
        } catch {
            loadError = error.localizedDescription
            print("AddPaperFromRepoViewModel: Failed to load files: \(error)")
        }

        isLoadingFiles = false
    }

    func navigateToFolder(_ folder: RepositoryFile) async {
        guard folder.isDirectory else { return }
        currentPath = folder.path
        await loadFiles()
    }

    func navigateUp() async {
        guard !currentPath.isEmpty else { return }

        let components = currentPath.components(separatedBy: "/")
        if components.count <= 1 {
            currentPath = ""
        } else {
            currentPath = components.dropLast().joined(separator: "/")
        }

        await loadFiles()
    }

    func navigateToBreadcrumb(index: Int) async {
        let components = breadcrumbs
        guard index < components.count else { return }

        if index == -1 {
            // Navigate to root
            currentPath = ""
        } else {
            currentPath = components[0...index].joined(separator: "/")
        }

        await loadFiles()
    }
}
