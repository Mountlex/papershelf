import SwiftUI

struct RepositoryListView: View {
    @State private var viewModel: RepositoryViewModel?
    @State private var repositoryToDelete: Repository?

    var body: some View {
        Group {
            if let viewModel = viewModel {
                repositoryListContent(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Repositories")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        await viewModel?.checkAllRepositories()
                    }
                } label: {
                    if viewModel?.isCheckingAll == true {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
                .disabled(viewModel?.isCheckingAll == true)
                .help("Check all repositories for updates")
            }
        }
        .task {
            if viewModel == nil {
                viewModel = RepositoryViewModel()
            }
            // Start real-time subscription
            viewModel?.startSubscription()
        }
        .onDisappear {
            viewModel?.stopSubscription()
        }
        .confirmationDialog(
            "Delete Repository?",
            isPresented: .init(
                get: { repositoryToDelete != nil },
                set: { if !$0 { repositoryToDelete = nil } }
            ),
            presenting: repositoryToDelete
        ) { repo in
            Button("Delete", role: .destructive) {
                Task {
                    await viewModel?.deleteRepository(repo)
                }
            }
            Button("Cancel", role: .cancel) {
                repositoryToDelete = nil
            }
        } message: { repo in
            Text("This will also delete all \(repo.paperCount) tracked papers from \"\(repo.name)\". This action cannot be undone.")
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
    private func repositoryListContent(viewModel: RepositoryViewModel) -> some View {
        if viewModel.repositories.isEmpty && !viewModel.isLoading {
            emptyState
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(viewModel.repositories) { repository in
                        NavigationLink(destination: AddPaperFromRepoView(repository: repository)) {
                            RepositoryCard(
                                repository: repository,
                                isRefreshing: viewModel.refreshingRepoId == repository.id
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                Task {
                                    await viewModel.refreshRepository(repository)
                                }
                            } label: {
                                Label("Check for Updates", systemImage: "arrow.clockwise")
                            }

                            Divider()

                            Button(role: .destructive) {
                                repositoryToDelete = repository
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                repositoryToDelete = repository
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
            Label("No Repositories", systemImage: "folder")
        } description: {
            Text("Add repositories on the web to see them here.")
        }
    }
}

#Preview {
    NavigationStack {
        RepositoryListView()
    }
}
