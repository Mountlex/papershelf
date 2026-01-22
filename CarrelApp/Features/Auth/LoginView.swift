import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var showingOAuth = false
    @State private var selectedProvider: OAuthProvider?

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [
                    Color(red: 0.1, green: 0.1, blue: 0.2),
                    Color(red: 0.15, green: 0.15, blue: 0.25)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 40) {
                Spacer()

                // Logo and title
                VStack(spacing: 16) {
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.white)

                    Text("Carrel")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Your paper gallery")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.7))
                }

                Spacer()

                // Sign in buttons
                VStack(spacing: 16) {
                    SignInButton(
                        provider: .github,
                        action: { signIn(with: .github) }
                    )

                    SignInButton(
                        provider: .gitlab,
                        action: { signIn(with: .gitlab) }
                    )
                }
                .padding(.horizontal, 32)

                Spacer()
                    .frame(height: 60)
            }
        }
        .sheet(isPresented: $showingOAuth) {
            if let provider = selectedProvider {
                OAuthWebView(provider: provider) { tokens in
                    Task {
                        await authManager.handleOAuthCallback(tokens: tokens)
                    }
                    showingOAuth = false
                }
            }
        }
    }

    private func signIn(with provider: OAuthProvider) {
        selectedProvider = provider
        showingOAuth = true
    }
}

struct SignInButton: View {
    let provider: OAuthProvider
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: provider.iconName)
                    .font(.title3)

                Text("Sign in with \(provider.displayName)")
                    .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
    }
}

enum OAuthProvider: String {
    case github
    case gitlab

    var displayName: String {
        switch self {
        case .github: return "GitHub"
        case .gitlab: return "GitLab"
        }
    }

    var iconName: String {
        switch self {
        case .github: return "network"
        case .gitlab: return "server.rack"
        }
    }
}

#Preview {
    LoginView()
        .environment(AuthManager())
}
