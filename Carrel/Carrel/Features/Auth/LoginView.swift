import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var authSession: ASWebAuthenticationSession?
    @State private var error: String?

    var body: some View {
        ZStack {
            // Background
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 40) {
                Spacer()

                // Logo and title
                VStack(spacing: 16) {
                    Text("Carrel")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)

                    Text("Your paper gallery")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                // Sign in buttons with unified glass sampling
                GlassEffectContainer {
                    VStack(spacing: 16) {
                        SignInButton(
                            provider: .github,
                            action: { signIn(with: .github) }
                        )

                        SignInButton(
                            provider: .gitlab,
                            action: { signIn(with: .gitlab) }
                        )

                        // Divider
                        HStack {
                            Rectangle()
                                .fill(.secondary.opacity(0.3))
                                .frame(height: 1)
                            Text("or")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Rectangle()
                                .fill(.secondary.opacity(0.3))
                                .frame(height: 1)
                        }

                        SignInButton(
                            provider: .email,
                            action: { signIn(with: .email) }
                        )
                    }
                }
                .padding(.horizontal, 32)

                Spacer()
                    .frame(height: 60)
            }
        }
        .alert("Error", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "Unknown error")
        }
    }

    private func signIn(with provider: OAuthProvider) {
        guard var components = URLComponents(
            url: AuthManager.siteURL.appendingPathComponent("mobile-auth"),
            resolvingAgainstBaseURL: true
        ) else {
            error = "Failed to build authentication URL"
            return
        }
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider.rawValue)
        ]

        guard let url = components.url else {
            error = "Failed to build authentication URL"
            return
        }

        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "carrel"
        ) { callbackURL, error in
            self.authSession = nil

            if let error = error as? ASWebAuthenticationSessionError,
               error.code == .canceledLogin {
                return
            }

            if let error = error {
                self.error = error.localizedDescription
                return
            }

            guard let callbackURL = callbackURL,
                  let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                  let queryItems = components.queryItems else {
                self.error = "Invalid callback"
                return
            }

            if let errorItem = queryItems.first(where: { $0.name == "error" }),
               let errorMessage = errorItem.value {
                self.error = errorMessage
                return
            }

            if let tokenItem = queryItems.first(where: { $0.name == "token" }),
               let token = tokenItem.value {
                Task {
                    await authManager.handleOAuthCallback(token: token)
                }
            }
        }

        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = WebAuthContextProvider.shared
        authSession = session
        session.start()
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
        }
        .buttonStyle(.liquidGlass)
        .foregroundStyle(.primary)
    }
}

enum OAuthProvider: String {
    case github
    case gitlab
    case email

    var displayName: String {
        switch self {
        case .github: return "GitHub"
        case .gitlab: return "GitLab"
        case .email: return "Email"
        }
    }

    var iconName: String {
        switch self {
        case .github: return "network"
        case .gitlab: return "server.rack"
        case .email: return "envelope.fill"
        }
    }
}

#Preview {
    LoginView()
        .environment(AuthManager())
}
