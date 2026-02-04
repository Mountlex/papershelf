import SwiftUI

/// Welcome onboarding view shown on first app launch.
/// Displays a carousel of pages explaining the app's features.
struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    @State private var currentPage = 0

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            icon: "doc.text.fill",
            title: "Welcome to Carrel",
            description: "Your personal gallery for academic papers and LaTeX documents."
        ),
        OnboardingPage(
            icon: "square.grid.2x2.fill",
            title: "Your Paper Gallery",
            description: "View all your papers in a beautiful, organized gallery with quick previews."
        ),
        OnboardingPage(
            icon: "arrow.triangle.branch",
            title: "Connect Your Repos",
            description: "Link your GitHub, GitLab, or Overleaf repositories to automatically sync papers."
        ),
        OnboardingPage(
            icon: "arrow.clockwise.circle.fill",
            title: "Always Up to Date",
            description: "Papers sync automatically when you push changes. Never worry about outdated PDFs."
        )
    ]

    var body: some View {
        ZStack {
            GlassBackdrop()
            VStack(spacing: 24) {
                // Page content
                TabView(selection: $currentPage) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                        OnboardingPageView(page: page)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                // Page indicator and button
                VStack(spacing: 24) {
                    // Page dots
                    HStack(spacing: 8) {
                        ForEach(0..<pages.count, id: \.self) { index in
                            Circle()
                                .fill(index == currentPage ? Color.primary.opacity(0.8) : Color.primary.opacity(0.2))
                                .frame(width: 8, height: 8)
                                .animation(.easeInOut(duration: 0.2), value: currentPage)
                        }
                    }

                    // Action button
                    Button {
                        if currentPage < pages.count - 1 {
                            withAnimation {
                                currentPage += 1
                            }
                        } else {
                            hasCompletedOnboarding = true
                        }
                    } label: {
                        Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                    }
                    .buttonStyle(.liquidGlass)
                    .padding(.horizontal, 24)

                    // Skip button (only on non-last pages)
                    if currentPage < pages.count - 1 {
                        Button("Skip") {
                            hasCompletedOnboarding = true
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom, 32)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Data model for an onboarding page
private struct OnboardingPage {
    let icon: String
    let title: String
    let description: String
}

/// View for a single onboarding page
private struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            GlassCard {
                VStack(spacing: 16) {
                    Image(systemName: page.icon)
                        .font(.system(size: 64))
                        .foregroundStyle(.primary)
                        .accessibilityHidden(true)

                    VStack(spacing: 12) {
                        Text(page.title)
                            .font(.title2)
                            .fontWeight(.bold)
                            .multilineTextAlignment(.center)

                        Text(page.description)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.vertical, 24)
                .padding(.horizontal, 20)
            }
            .padding(.horizontal, 24)

            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(page.title). \(page.description)")
    }
}

#Preview {
    OnboardingView(hasCompletedOnboarding: .constant(false))
}
