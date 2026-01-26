import SwiftUI

struct StatusBadge: View {
    let status: PaperStatus

    var body: some View {
        HStack(spacing: 4) {
            if status == .building {
                ProgressView()
                    .scaleEffect(0.5)
                    .frame(width: 8, height: 8)
            } else {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
            }

            Text(statusText)
                .font(.caption2)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(statusColor.opacity(0.15))
        .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch status {
        case .synced:
            return .green
        case .pending:
            return .orange
        case .building:
            return .blue
        case .error:
            return .red
        case .unknown:
            return .gray
        }
    }

    private var statusText: String {
        switch status {
        case .synced:
            return "Synced"
        case .pending:
            return "Pending"
        case .building:
            return "Building"
        case .error:
            return "Error"
        case .unknown:
            return "Unknown"
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        StatusBadge(status: .synced)
        StatusBadge(status: .pending)
        StatusBadge(status: .building)
        StatusBadge(status: .error)
        StatusBadge(status: .unknown)
    }
    .padding()
}
