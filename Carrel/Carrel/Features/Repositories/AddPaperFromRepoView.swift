import SwiftUI

struct AddPaperFromRepoView: View {
    let repository: Repository
    @State private var viewModel: AddPaperFromRepoViewModel
    @State private var selectedFilePath: String?
    @Environment(\.dismiss) private var dismiss

    init(repository: Repository) {
        self.repository = repository
        self._viewModel = State(initialValue: AddPaperFromRepoViewModel(repository: repository))
    }

    var body: some View {
        fileBrowserSection
            .navigationTitle("Add Paper")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await viewModel.loadFiles()
            }
            .sheet(item: Binding(
                get: { selectedFilePath.map { SelectedFile(path: $0) } },
                set: { selectedFilePath = $0?.path }
            )) { file in
                ConfigurePaperSheet(
                    repository: repository,
                    filePath: file.path,
                    onDismiss: { dismiss() }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
    }

    // MARK: - File Browser Section

    private var fileBrowserSection: some View {
        VStack(spacing: 0) {
            // Breadcrumb navigation
            breadcrumbNavigation
                .padding(.horizontal)
                .padding(.bottom, 8)

            Divider()

            // File list
            if viewModel.isLoadingFiles {
                Spacer()
                ProgressView("Loading files...")
                Spacer()
            } else if let error = viewModel.loadError {
                Spacer()
                ContentUnavailableView {
                    Label("Failed to Load", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        Task {
                            await viewModel.loadFiles()
                        }
                    }
                }
                Spacer()
            } else if viewModel.files.isEmpty {
                Spacer()
                ContentUnavailableView {
                    Label("No Files", systemImage: "folder")
                } description: {
                    Text("No .tex or .pdf files found in this directory.")
                }
                Spacer()
            } else {
                fileList
            }
        }
    }

    private var breadcrumbNavigation: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                // Root button
                Button {
                    Task {
                        await viewModel.navigateToBreadcrumb(index: -1)
                    }
                } label: {
                    Image(systemName: "house.fill")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if !viewModel.breadcrumbs.isEmpty {
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                ForEach(Array(viewModel.breadcrumbs.enumerated()), id: \.offset) { index, name in
                    Button(name) {
                        Task {
                            await viewModel.navigateToBreadcrumb(index: index)
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    if index < viewModel.breadcrumbs.count - 1 {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    private var fileList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                // Back button if not at root
                if !viewModel.currentPath.isEmpty {
                    Button {
                        Task {
                            await viewModel.navigateUp()
                        }
                    } label: {
                        FileRow(
                            icon: "arrow.left",
                            iconColor: .secondary,
                            name: "..",
                            isTracked: false
                        )
                    }
                    .buttonStyle(.plain)
                }

                ForEach(viewModel.files) { file in
                    if file.isDirectory {
                        Button {
                            Task {
                                await viewModel.navigateToFolder(file)
                            }
                        } label: {
                            FileRow(
                                icon: "folder.fill",
                                iconColor: .blue,
                                name: file.name,
                                isTracked: false
                            )
                        }
                        .buttonStyle(.plain)
                    } else {
                        let isTracked = viewModel.isFileTracked(file.path)
                        if isTracked {
                            // Already tracked - show but don't allow tapping
                            FileRow(
                                icon: file.isTexFile ? "doc.text.fill" : "doc.fill",
                                iconColor: .secondary,
                                name: file.name,
                                isTracked: true
                            )
                        } else {
                            Button {
                                selectedFilePath = file.path
                            } label: {
                                FileRow(
                                    icon: file.isTexFile ? "doc.text.fill" : "doc.fill",
                                    iconColor: file.isTexFile ? .green : .red,
                                    name: file.name,
                                    isTracked: false
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding()
        }
    }

}

// MARK: - Helper Types

private struct SelectedFile: Identifiable {
    let path: String
    var id: String { path }
}

// MARK: - File Row Component

private struct FileRow: View {
    let icon: String
    let iconColor: Color
    let name: String
    let isTracked: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(iconColor)
                .frame(width: 24)

            Text(name)
                .font(.body)
                .lineLimit(1)
                .foregroundStyle(isTracked ? .secondary : .primary)

            Spacer()

            if isTracked {
                Image(systemName: "checkmark.circle.fill")
                    .font(.body)
                    .foregroundStyle(.green)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(.systemGray6))
        )
    }
}

#Preview {
    NavigationStack {
        AddPaperFromRepoView(repository: .preview)
    }
}
