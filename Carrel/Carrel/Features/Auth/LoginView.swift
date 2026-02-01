import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var showingOAuth = false
    @State private var showingEmailSignIn = false
    @State private var selectedProvider: OAuthProvider?

    var body: some View {
        ZStack {
            // Background
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 40) {
                Spacer()

                // Logo and title
                VStack(spacing: 16) {
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.primary)

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

                        // Email sign in button
                        Button {
                            showingEmailSignIn = true
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "envelope.fill")
                                    .font(.title3)

                                Text("Sign in with Email")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                        }
                        .buttonStyle(.liquidGlass)
                        .foregroundStyle(.primary)
                    }
                }
                .padding(.horizontal, 32)

                Spacer()
                    .frame(height: 60)
            }
        }
        .sheet(isPresented: $showingOAuth) {
            if let provider = selectedProvider {
                OAuthWebView(provider: provider) { token in
                    Task {
                        await authManager.handleOAuthCallback(token: token)
                    }
                    showingOAuth = false
                }
            }
        }
        .sheet(isPresented: $showingEmailSignIn) {
            EmailSignInView()
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
        }
        .buttonStyle(.liquidGlass)
        .foregroundStyle(.primary)
    }
}

struct EmailSignInView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss

    @State private var showingWebAuth = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer()

                Image(systemName: "envelope.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)

                Text("Sign in with Email")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("You'll be redirected to sign in with your email and password securely.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Button {
                    showingWebAuth = true
                } label: {
                    Text("Continue")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal, 40)

                Spacer()
            }
            .navigationTitle("Email Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showingWebAuth) {
                // Use email provider through OAuth web view
                EmailWebAuthView { token in
                    Task {
                        await authManager.handleOAuthCallback(token: token)
                    }
                    showingWebAuth = false
                    dismiss()
                }
            }
        }
    }
}

/// Web view for email authentication through the mobile-auth page
struct EmailWebAuthView: View {
    let onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true
    @State private var error: String?

    private var emailAuthURL: URL {
        var components = URLComponents(url: AuthManager.siteURL.appendingPathComponent("mobile-auth"), resolvingAgainstBaseURL: true)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "email")
        ]
        return components.url!
    }

    var body: some View {
        NavigationStack {
            ZStack {
                WebView(
                    url: emailAuthURL,
                    isLoading: $isLoading,
                    onTokenReceived: { token in
                        onSuccess(token)
                    },
                    onError: { errorMessage in
                        error = errorMessage
                    }
                )

                if isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                }
            }
            .navigationTitle("Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") {
                    error = nil
                    dismiss()
                }
            } message: {
                Text(error ?? "Unknown error")
            }
        }
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
