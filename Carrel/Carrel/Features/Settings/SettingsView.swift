import SwiftUI

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel: SettingsViewModel?
    @State private var showingLogoutConfirmation = false
    @State private var pdfCacheSize: Int64 = 0
    @State private var thumbnailCacheSize: Int64 = 0

    var body: some View {
        ZStack {
            GlassBackdrop()
            Group {
                if let viewModel = viewModel {
                    settingsContent(viewModel: viewModel)
                } else {
                    ProgressView()
                }
            }
        }
        .navigationTitle("Settings")
        .task {
            if viewModel == nil {
                viewModel = SettingsViewModel(authManager: authManager)
            }
            await viewModel?.loadUser()
            await viewModel?.loadNotificationPreferences()
            pdfCacheSize = await PDFCache.shared.cacheSize()
            thumbnailCacheSize = await ThumbnailCache.shared.cacheSize()
        }
    }

    @ViewBuilder
    private func settingsContent(viewModel: SettingsViewModel) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                GlassSection(title: "Account") {
                    accountSectionContent(viewModel: viewModel)
                }

                GlassSection(title: "Notifications") {
                    notificationsSectionContent(viewModel: viewModel)
                }

                GlassSection(title: "Storage") {
                    storageSectionContent()
                }

                GlassSection(title: "About") {
                    aboutSectionContent()
                }

                Button(role: .destructive) {
                    showingLogoutConfirmation = true
                } label: {
                    HStack {
                        Spacer()
                        Text("Sign Out")
                            .foregroundStyle(.red)
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.liquidGlass)
                .accessibilityHint("Sign out of your account")
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 20)
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

    @ViewBuilder
    private func accountSectionContent(viewModel: SettingsViewModel) -> some View {
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
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if viewModel.isLoading {
            HStack {
                Spacer()
                ProgressView()
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .center)
        } else {
            Text("Failed to load user")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func storageSectionContent() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent("PDF Cache", value: formatBytes(pdfCacheSize))
            Divider()
            LabeledContent("Thumbnail Cache", value: formatBytes(thumbnailCacheSize))
            Divider()
            Button {
                Task {
                    await PDFCache.shared.clearCache()
                    await ThumbnailCache.shared.clearCache()
                    pdfCacheSize = 0
                    thumbnailCacheSize = 0
                }
            } label: {
                HStack {
                    Spacer()
                    Text("Clear All Caches")
                    Spacer()
                }
                .padding(.vertical, 4)
            }
            .buttonStyle(.liquidGlass)
            .disabled(pdfCacheSize == 0 && thumbnailCacheSize == 0)
            .accessibilityHint("Removes all cached PDFs and thumbnails")
        }
    }

    private func notificationsSectionContent(viewModel: SettingsViewModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle("Enable Notifications", isOn: preferenceBinding(\.enabled, viewModel: viewModel))
                .onChange(of: viewModel.notificationPreferences.enabled) { _, enabled in
                    Task { @MainActor in
                        if enabled {
                            let granted = await PushNotificationManager.shared.requestAuthorization()
                            if !granted {
                                viewModel.notificationPreferences.enabled = false
                                await viewModel.updateNotificationPreferences()
                                return
                            }
                        } else {
                            await PushNotificationManager.shared.unregisterDeviceToken()
                        }
                        await viewModel.updateNotificationPreferences()
                    }
                }

            Divider()

            Toggle("Build Completed", isOn: preferenceBinding(\.buildSuccess, viewModel: viewModel))
                .disabled(!viewModel.notificationPreferences.enabled)
                .onChange(of: viewModel.notificationPreferences.buildSuccess) { _, _ in
                    Task { await viewModel.updateNotificationPreferences() }
                }

            Divider()

            Toggle("Build Failed", isOn: preferenceBinding(\.buildFailure, viewModel: viewModel))
                .disabled(!viewModel.notificationPreferences.enabled)
                .onChange(of: viewModel.notificationPreferences.buildFailure) { _, _ in
                    Task { await viewModel.updateNotificationPreferences() }
                }

            Divider()

            Toggle("Paper Updated", isOn: preferenceBinding(\.paperUpdated, viewModel: viewModel))
                .disabled(!viewModel.notificationPreferences.enabled)
                .onChange(of: viewModel.notificationPreferences.paperUpdated) { _, _ in
                    Task { await viewModel.updateNotificationPreferences() }
                }

            Divider()

            Toggle("Background Refresh", isOn: preferenceBinding(\.backgroundSync, viewModel: viewModel))
                .disabled(!viewModel.notificationPreferences.enabled)
                .onChange(of: viewModel.notificationPreferences.backgroundSync) { _, _ in
                    Task { await viewModel.updateNotificationPreferences() }
                }
                .accessibilityHint("Allows silent refresh when notifications arrive")

            Divider()

            Button {
                Task { @MainActor in
                    if !viewModel.notificationPreferences.enabled {
                        viewModel.setError("Enable notifications to send a test.")
                        return
                    }
                    let granted = await PushNotificationManager.shared.requestAuthorization()
                    guard granted else {
                        viewModel.setError("Notification permission not granted.")
                        return
                    }
                    await viewModel.sendTestNotification()
                }
            } label: {
                HStack {
                    Spacer()
                    Text("Send Test Notification")
                    Spacer()
                }
                .padding(.vertical, 4)
            }
            .buttonStyle(.liquidGlass)
            .disabled(viewModel.isNotificationsUpdating)
        }
        .tint(.orange)
    }

    private func preferenceBinding(
        _ keyPath: WritableKeyPath<NotificationPreferences, Bool>,
        viewModel: SettingsViewModel
    ) -> Binding<Bool> {
        Binding(
            get: { viewModel.notificationPreferences[keyPath: keyPath] },
            set: { viewModel.notificationPreferences[keyPath: keyPath] = $0 }
        )
    }

    private func aboutSectionContent() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent("Version", value: Bundle.main.appVersionString)
            Divider()
            LabeledContent("Build", value: Bundle.main.buildNumber)
            if let websiteURL = URL(string: "https://carrelapp.com") {
                Divider()
                Link(destination: websiteURL) {
                    HStack {
                        Text("Website")
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .foregroundStyle(.primary)
            }
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
