import SwiftUI

struct GalleryView: View {
    @State private var viewModel: GalleryViewModel?
    @State private var selectedPaper: Paper?

    private let columns = [
        GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 16)
    ]

    var body: some View {
        Group {
            if let viewModel = viewModel {
                galleryContent(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Papers")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 12) {
                    // Check All Repositories button
                    Button {
                        Task {
                            await viewModel?.checkAllRepositories()
                        }
                    } label: {
                        if viewModel?.isSyncing == true {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                    }
                    .disabled(viewModel?.isSyncing == true)
                    .help("Check all repositories for updates")

                    // Refresh All Papers button
                    Button {
                        Task {
                            await viewModel?.refreshAllPapers()
                        }
                    } label: {
                        if let progress = viewModel?.refreshProgress {
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
                    .disabled(viewModel?.isRefreshingAll == true)
                    .help("Refresh all papers that need sync")
                }
            }
        }
        .task {
            if viewModel == nil {
                viewModel = GalleryViewModel()
            }
            // Start real-time subscription
            viewModel?.startSubscription()
        }
        .onDisappear {
            viewModel?.stopSubscription()
        }
        .sheet(item: $selectedPaper) { paper in
            NavigationStack {
                PaperDetailView(paper: paper)
            }
        }
        .overlay(alignment: .top) {
            ToastContainer(message: Binding(
                get: { viewModel?.toastMessage },
                set: { viewModel?.toastMessage = $0 }
            ))
            .padding(.top, 8)
        }
    }

    @ViewBuilder
    private func galleryContent(viewModel: GalleryViewModel) -> some View {
        if viewModel.papers.isEmpty && !viewModel.isLoading {
            emptyState
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(viewModel.papers) { paper in
                        Button {
                            selectedPaper = paper
                        } label: {
                            PaperCard(
                                paper: paper,
                                isSyncing: viewModel.syncingPaperId == paper.id
                            )
                        }
                        .buttonStyle(.plain)
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
