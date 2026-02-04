import SwiftUI

struct RepositoryListView: View {
    @State private var viewModel = RepositoryViewModel()
    @State private var repositoryToDelete: Repository?
    @State private var selectedRepository: Repository?

    var body: some View {
        repositoryListContent(viewModel: viewModel)
            .navigationTitle("Repositories")
            .navigationDestination(item: $selectedRepository) { repository in
                AddPaperFromRepoView(repository: repository)
            }
            .onAppear {
                Task {
                    await viewModel.loadNotificationPreferences()
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task {
                            await viewModel.checkAllRepositories()
                        }
                    } label: {
                        if viewModel.isCheckingAll {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                    }
                    .disabled(viewModel.isCheckingAll)
                    .help("Check all repositories for updates")
                    .accessibilityLabel("Check repositories")
                    .accessibilityHint("Check all repositories for updates")
                }
            }
            .manageSubscription(viewModel)
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
                        await viewModel.deleteRepository(repo)
                    }
                }
                Button("Cancel", role: .cancel) {
                    repositoryToDelete = nil
                }
            } message: { repo in
                Text("This will also delete all \(repo.paperCount) tracked papers from \"\(repo.name)\". This action cannot be undone.")
            }
            .overlay(alignment: .top) {
                ToastContainer(message: $viewModel.toastMessage)
                    .padding(.top, 8)
            }
    }

    @ViewBuilder
    private func repositoryListContent(viewModel: RepositoryViewModel) -> some View {
        if viewModel.repositories.isEmpty && !viewModel.isLoading {
            emptyState
        } else {
            VStack(spacing: 8) {
                if !viewModel.isBackgroundRefreshEnabledGlobally {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "clock.badge.xmark")
                            .foregroundStyle(.orange)
                        Text("Background refresh is disabled in Settings.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }

                List {
                    ForEach(viewModel.repositories) { repository in
                        Button {
                            selectedRepository = repository
                        } label: {
                            RepositoryCard(
                                repository: repository,
                                isRefreshing: viewModel.refreshingRepoId == repository.id,
                                showsBackgroundRefreshBadge: viewModel.isBackgroundRefreshEnabledGlobally
                            )
                            .contentShape(Rectangle())
                            .padding(.horizontal, 16)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("repository_card_\(repository.id)")
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            Button {
                                Task {
                                    await viewModel.refreshRepository(repository)
                                }
                            } label: {
                                Label("Update", systemImage: "arrow.clockwise")
                            }
                            .tint(.orange)

                            if viewModel.isBackgroundRefreshEnabledGlobally {
                                Button {
                                    Task {
                                        await viewModel.setBackgroundRefresh(
                                            repository,
                                            enabled: !repository.backgroundRefreshEnabled
                                        )
                                    }
                                } label: {
                                    let isEnabled = repository.backgroundRefreshEnabled
                                    Label(
                                        isEnabled ? "Disable Background" : "Enable Background",
                                        systemImage: isEnabled ? "clock.badge.xmark" : "clock.arrow.circlepath"
                                    )
                                }
                                .tint(.orange)
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                repositoryToDelete = repository
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            .tint(.red)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable {
                    await viewModel.checkAllRepositories()
                }
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
