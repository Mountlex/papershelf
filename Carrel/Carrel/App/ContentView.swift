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
    }
}

#Preview {
    ContentView()
        .environment(AuthManager())
}
