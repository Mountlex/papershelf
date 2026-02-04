import SwiftUI

struct ContentView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .task {
            await authManager.loadStoredTokens()
        }
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            PushNotificationManager.shared.setAuthenticated(isAuthenticated)
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                GalleryView()
            }
            .tabItem {
                Label("Papers", systemImage: "doc.text.fill")
            }

            NavigationStack {
                RepositoryListView()
            }
            .tabItem {
                Label("Repositories", systemImage: "folder.fill")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gear")
            }
        }
        .tint(.primary)
        .overlay(alignment: .top) {
            OfflineBannerOverlay()
        }
    }
}

/// Separate view for offline banner to isolate observation
private struct OfflineBannerOverlay: View {
    @State private var showBanner = false

    var body: some View {
        Group {
            if showBanner {
                OfflineBanner()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.3), value: showBanner)
        .task {
            // Initial state
            showBanner = !NetworkMonitor.shared.isConnected
        }
        .onReceive(NotificationCenter.default.publisher(for: .networkStatusChanged)) { notification in
            if let isConnected = notification.object as? Bool {
                showBanner = !isConnected
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthManager())
}
