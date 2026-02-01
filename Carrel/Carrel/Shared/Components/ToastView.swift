import SwiftUI

/// Type of toast message to display
enum ToastType {
    case info
    case success
    case error
}

/// A toast message to display
struct ToastMessage: Equatable, Identifiable {
    let id = UUID()
    let text: String
    let type: ToastType

    init(text: String, type: ToastType) {
        self.text = text
        self.type = type
    }

    static func == (lhs: ToastMessage, rhs: ToastMessage) -> Bool {
        lhs.id == rhs.id
    }
}

/// Toast notification view that appears at the top of the screen
struct ToastView: View {
    let message: ToastMessage

    var body: some View {
        HStack(spacing: 8) {
            icon
            Text(message.text)
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(backgroundColor)
        )
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
    }

    @ViewBuilder
    private var icon: some View {
        switch message.type {
        case .info:
            Image(systemName: "info.circle.fill")
        case .success:
            Image(systemName: "checkmark.circle.fill")
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
        }
    }

    private var backgroundColor: Color {
        switch message.type {
        case .info:
            return .blue
        case .success:
            return .green
        case .error:
            return .red
        }
    }
}

/// Toast container that handles showing/hiding toasts with animation
struct ToastContainer: View {
    @Binding var message: ToastMessage?
    let duration: TimeInterval

    @State private var isVisible = false
    @State private var hideTask: Task<Void, Never>?

    init(message: Binding<ToastMessage?>, duration: TimeInterval = 3.0) {
        self._message = message
        self.duration = duration
    }

    var body: some View {
        VStack {
            if isVisible, let message = message {
                ToastView(message: message)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .animation(.spring(duration: 0.3), value: isVisible)
        .onChange(of: message) { _, newMessage in
            // Cancel any existing hide task
            hideTask?.cancel()

            if newMessage != nil {
                isVisible = true

                // Schedule auto-hide
                hideTask = Task {
                    try? await Task.sleep(for: .seconds(duration))
                    if !Task.isCancelled {
                        await MainActor.run {
                            isVisible = false
                            // Clear the message after animation completes
                            Task {
                                try? await Task.sleep(for: .milliseconds(300))
                                if !Task.isCancelled && self.message?.id == newMessage?.id {
                                    self.message = nil
                                }
                            }
                        }
                    }
                }
            } else {
                isVisible = false
            }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        ToastView(message: .init(text: "All repos recently checked", type: .info))
        ToastView(message: .init(text: "Refreshed 5 papers", type: .success))
        ToastView(message: .init(text: "3 repos failed to sync", type: .error))
    }
    .padding()
}
