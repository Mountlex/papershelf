import SwiftUI

@main
struct CarrelApp: App {
    @State private var authManager = AuthManager()
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    var body: some Scene {
        WindowGroup {
            Group {
                if hasCompletedOnboarding {
                    ContentView()
                } else {
                    OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                }
            }
            .environment(authManager)
            .task {
                // Start network monitoring
                NetworkMonitor.shared.start()
            }
        }
    }
}
