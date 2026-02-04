import SwiftUI

struct GalleryView: View {
    @State private var viewModel = GalleryViewModel()
    @State private var selectedPaper: Paper?
    @State private var searchText = ""
    @State private var isOffline = false
    private let searchBarTopInset: CGFloat = 6

    private let columns = [
        GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 16)
    ]

    /// Papers filtered by search text
    private var filteredPapers: [Paper] {
        if searchText.isEmpty {
            return viewModel.papers
        }
        return viewModel.papers.filter { paper in
            paper.title?.localizedCaseInsensitiveContains(searchText) ?? false
        }
    }

    var body: some View {
        galleryContent(viewModel: viewModel)
            .navigationTitle("Papers")
            .searchable(text: $searchText, prompt: "Search papers")
            .safeAreaInset(edge: .top) {
                Color.clear.frame(height: searchBarTopInset)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 12) {
                        // Check All Repositories button
                        Button {
                            Task {
                                await viewModel.checkAllRepositories()
                            }
                        } label: {
                            if viewModel.isSyncing {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "arrow.triangle.2.circlepath")
                            }
                        }
                        .disabled(viewModel.isSyncing)
                        .help("Check all repositories for updates")
                        .accessibilityLabel("Check repositories")
                        .accessibilityHint("Check all repositories for updates")

                        // Refresh All Papers button
                        Button {
                            Task {
                                await viewModel.refreshAllPapers()
                            }
                        } label: {
                            if let progress = viewModel.refreshProgress {
                                HStack(spacing: 4) {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                    Text("\(progress.current)/\(progress.total)")
                                        .font(.caption)
                                        .monospacedDigit()
                                }
                            } else {
                                Image(systemName: "play.fill")
                            }
                        }
                        .disabled(viewModel.isRefreshingAll)
                        .help("Refresh all papers that need sync")
                        .accessibilityLabel("Refresh papers")
                        .accessibilityHint("Refresh all papers that need sync")
                    }
                }
            }
            .manageSubscription(viewModel)
            .sheet(item: $selectedPaper) { paper in
                NavigationStack {
                    PaperDetailView(paper: paper)
                }
            }
            .overlay(alignment: .top) {
                ToastContainer(message: $viewModel.toastMessage)
                    .padding(.top, 8)
            }
            .onReceive(NotificationCenter.default.publisher(for: .networkStatusChanged)) { notification in
                if let connected = notification.object as? Bool {
                    isOffline = !connected
                }
            }
            .onAppear {
                isOffline = !NetworkMonitor.shared.isConnected
            }
    }

    @ViewBuilder
    private func galleryContent(viewModel: GalleryViewModel) -> some View {
        if viewModel.papers.isEmpty && !viewModel.isLoading {
            emptyState
        } else if filteredPapers.isEmpty && !searchText.isEmpty {
            ContentUnavailableView.search(text: searchText)
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(filteredPapers) { paper in
                        Button {
                            selectedPaper = paper
                        } label: {
                            PaperCard(
                                paper: paper,
                                isSyncing: viewModel.syncingPaperId == paper.id,
                                isOffline: isOffline
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("gallery_paper_card_\(paper.id)")
                        .contextMenu {
                            Button {
                                Task {
                                    await viewModel.buildPaper(paper)
                                }
                            } label: {
                                Label("Sync", systemImage: "arrow.clockwise")
                            }

                            Button {
                                Task {
                                    await viewModel.buildPaper(paper, force: true)
                                }
                            } label: {
                                Label("Force Rebuild", systemImage: "hammer")
                            }

                            Divider()

                            Button(role: .destructive) {
                                Task {
                                    await viewModel.deletePaper(paper)
                                }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
                .padding()
            }
            .refreshable {
                await viewModel.checkAllRepositories()
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Papers", systemImage: "doc.text")
        } description: {
            Text("Add repositories on the web to see your papers here.")
        }
    }
}

#Preview {
    NavigationStack {
        GalleryView()
    }
}
