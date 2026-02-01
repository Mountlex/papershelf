import SwiftUI

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel: SettingsViewModel?
    @State private var showingLogoutConfirmation = false
    @State private var pdfCacheSize: Int64 = 0
    @State private var thumbnailCacheSize: Int64 = 0

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
            pdfCacheSize = await PDFCache.shared.cacheSize()
            thumbnailCacheSize = await ThumbnailCache.shared.cacheSize()
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
                        if let imageUrl = user.image, let url = URL(string: imageUrl) {
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

                            if let email = user.email {
                                Text(email)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            // Show connected providers
                            HStack(spacing: 4) {
                                if user.hasGitHubToken == true {
                                    ProviderBadge(provider: "github")
                                }
                                if user.hasGitLabToken == true {
                                    ProviderBadge(provider: "gitlab")
                                }
                                if user.hasOverleafCredentials == true {
                                    ProviderBadge(provider: "overleaf")
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

            // Storage section
            Section("Storage") {
                LabeledContent("PDF Cache", value: formatBytes(pdfCacheSize))
                LabeledContent("Thumbnail Cache", value: formatBytes(thumbnailCacheSize))

                Button("Clear All Caches") {
                    Task {
                        await PDFCache.shared.clearCache()
                        await ThumbnailCache.shared.clearCache()
                        pdfCacheSize = 0
                        thumbnailCacheSize = 0
                    }
                }
                .disabled(pdfCacheSize == 0 && thumbnailCacheSize == 0)
            }

            // About section
            Section("About") {
                LabeledContent("Version", value: Bundle.main.appVersionString)
                LabeledContent("Build", value: Bundle.main.buildNumber)

                Link(destination: URL(string: "https://carrelapp.com")!) {
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
        .alert(
            "Sign Out",
            isPresented: $showingLogoutConfirmation
        ) {
            Button("Cancel", role: .cancel) {}
            Button("Sign Out", role: .destructive) {
                Task {
                    await viewModel.logout()
                }
            }
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
        .glassEffect(.regular, in: Capsule())
    }

    private var displayName: String {
        switch provider.lowercased() {
        case "github": return "GitHub"
        case "gitlab": return "GitLab"
        case "overleaf": return "Overleaf"
        default: return provider.capitalized
        }
    }

    private var iconName: String {
        switch provider.lowercased() {
        case "github": return "network"
        case "gitlab": return "server.rack"
        case "overleaf": return "leaf"
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

private func formatBytes(_ bytes: Int64) -> String {
    if bytes == 0 { return "0 MB" }
    let mb = Double(bytes) / (1024 * 1024)
    if mb < 0.1 { return "<0.1 MB" }
    return String(format: "%.1f MB", mb)
}

#Preview {
    NavigationStack {
        SettingsView()
    }
    .environment(AuthManager())
}
