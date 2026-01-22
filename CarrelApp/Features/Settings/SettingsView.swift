import SwiftUI

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel: SettingsViewModel?
    @State private var showingLogoutConfirmation = false

    var body: some View {
        Group {
            if let viewModel = viewModel {
                settingsContent(viewModel: viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Settings")
        .task {
            if viewModel == nil {
                viewModel = SettingsViewModel(authManager: authManager)
            }
            await viewModel?.loadUser()
        }
    }

    @ViewBuilder
    private func settingsContent(viewModel: SettingsViewModel) -> some View {
        List {
            // Account section
            Section("Account") {
                if let user = viewModel.user {
                    HStack(spacing: 16) {
                        // Avatar
                        if let avatarUrl = user.avatarUrl, let url = URL(string: avatarUrl) {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                default:
                                    avatarPlaceholder
                                }
                            }
                            .frame(width: 56, height: 56)
                            .clipShape(Circle())
                        } else {
                            avatarPlaceholder
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            if let name = user.name {
                                Text(name)
                                    .font(.headline)
                            }

                            Text(user.email)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)

                            if !user.providers.isEmpty {
                                HStack(spacing: 4) {
                                    ForEach(user.providers, id: \.self) { provider in
                                        ProviderBadge(provider: provider)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.vertical, 8)
                } else if viewModel.isLoading {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Text("Failed to load user")
                        .foregroundStyle(.secondary)
                }
            }

            // About section
            Section("About") {
                LabeledContent("Version", value: Bundle.main.appVersionString)
                LabeledContent("Build", value: Bundle.main.buildNumber)

                Link(destination: URL(string: "https://carrel.app")!) {
                    HStack {
                        Text("Website")
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            // Sign out
            Section {
                Button(role: .destructive) {
                    showingLogoutConfirmation = true
                } label: {
                    HStack {
                        Spacer()
                        Text("Sign Out")
                        Spacer()
                    }
                }
            }
        }
        .confirmationDialog(
            "Sign Out",
            isPresented: $showingLogoutConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sign Out", role: .destructive) {
                Task {
                    await viewModel.logout()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to sign out?")
        }
        .alert("Error", isPresented: .constant(viewModel.error != nil)) {
            Button("OK") {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.error ?? "Unknown error")
        }
    }

    private var avatarPlaceholder: some View {
        Circle()
            .fill(.quaternary)
            .frame(width: 56, height: 56)
            .overlay {
                Image(systemName: "person.fill")
                    .foregroundStyle(.tertiary)
            }
    }
}

struct ProviderBadge: View {
    let provider: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: iconName)
                .font(.caption2)

            Text(displayName)
                .font(.caption2)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(.quaternary)
        .clipShape(Capsule())
    }

    private var displayName: String {
        switch provider.lowercased() {
        case "github": return "GitHub"
        case "gitlab": return "GitLab"
        default: return provider.capitalized
        }
    }

    private var iconName: String {
        switch provider.lowercased() {
        case "github": return "network"
        case "gitlab": return "server.rack"
        default: return "key"
        }
    }
}

extension Bundle {
    var appVersionString: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    var buildNumber: String {
        infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}

#Preview {
    NavigationStack {
        SettingsView()
    }
    .environment(AuthManager())
}
