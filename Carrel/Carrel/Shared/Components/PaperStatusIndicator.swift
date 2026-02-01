import SwiftUI

/// Rich status indicator for paper detail view, showing status icon and relative time
struct PaperStatusIndicator: View {
    let paper: Paper

    var body: some View {
        HStack(spacing: 6) {
            statusIcon
            Text(statusText)
                .font(.subheadline)
        }
        .foregroundStyle(statusColor)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch paper.status {
        case .building:
            ProgressView()
                .scaleEffect(0.7)
        case .synced:
            Image(systemName: "checkmark.circle.fill")
        case .pending:
            Image(systemName: "arrow.triangle.2.circlepath")
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
        case .uploaded, .unknown:
            Image(systemName: "doc.fill")
        }
    }

    private var statusText: String {
        switch paper.status {
        case .building:
            return paper.compilationProgress ?? "Compiling..."
        case .synced:
            if let commitTime = paper.lastAffectedCommitTime {
                return commitTime.relativeFormatted
            }
            return "Up to date"
        case .pending:
            if let commitTime = paper.lastAffectedCommitTime {
                return commitTime.relativeFormatted
            }
            return "Needs sync"
        case .error:
            if let error = paper.lastSyncError {
                if error.contains("not found") {
                    return "File missing"
                }
            }
            return "Sync failed"
        case .uploaded:
            return "Uploaded"
        case .unknown:
            return ""
        }
    }

    private var statusColor: Color {
        switch paper.status {
        case .synced:
            return .green
        case .pending:
            return .yellow
        case .building:
            return .blue
        case .error:
            return .red
        case .uploaded, .unknown:
            return .gray
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        PaperStatusIndicator(paper: Paper.preview)
        PaperStatusIndicator(paper: Paper.previewError)
    }
    .padding()
}
