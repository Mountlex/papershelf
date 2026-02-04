import SwiftUI

struct RepositoryCard: View {
    let repository: Repository
    var isRefreshing: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header: Provider icon and name
            HStack(spacing: 10) {
                Image(systemName: repository.provider.iconName)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(repository.name)
                        .font(.headline)
                        .lineLimit(1)

                    Text(repository.provider.displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if isRefreshing {
                    ProgressView()
                        .scaleEffect(0.8)
                } else {
                    statusBadge
                }

                if repository.backgroundRefreshEnabled {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Background refresh enabled")
                }
            }

            // Stats row
            HStack(spacing: 16) {
                // Paper count
                Label {
                    Text("\(repository.paperCount)")
                        .monospacedDigit()
                } icon: {
                    Image(systemName: "doc.text")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                // Error count (if any)
                if repository.papersWithErrors > 0 {
                    Label {
                        Text("\(repository.papersWithErrors)")
                            .monospacedDigit()
                    } icon: {
                        Image(systemName: "exclamationmark.triangle")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.red)
                }

                Spacer()

                // Latest commit time
                if let lastCommitTime = repository.lastCommitTime {
                    Text(lastCommitTime, format: .dateTime.month(.abbreviated).day().year().hour().minute())
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(16)
        .glassEffect(
            .regular.interactive(),
            in: RoundedRectangle(cornerRadius: 16)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Double tap to view papers and add tracked files")
    }

    /// Accessibility label for the entire card
    private var accessibilityLabel: String {
        var components: [String] = [repository.name]
        components.append(repository.provider.displayName)
        components.append("\(repository.paperCount) papers")

        if repository.papersWithErrors > 0 {
            components.append("\(repository.papersWithErrors) with errors")
        }

        if isRefreshing {
            components.append("refreshing")
        } else {
            components.append(statusAccessibilityLabel)
        }

        if repository.backgroundRefreshEnabled {
            components.append("background refresh enabled")
        }

        return components.joined(separator: ", ")
    }

    /// Accessibility label for the status
    private var statusAccessibilityLabel: String {
        if repository.syncStatus == .error {
            return "sync error"
        }

        switch repository.paperSyncStatus {
        case .inSync:
            return "all papers synced"
        case .needsSync:
            return "some papers need sync"
        case .neverSynced:
            return "never synced"
        case .noPapers:
            return "no papers tracked"
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            Text(statusText)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .glassEffect(
            .regular.tint(statusColor.opacity(0.25)),
            in: Capsule()
        )
        .foregroundStyle(statusColor)
    }

    private var statusColor: Color {
        // First check if there's a sync error at the repository level
        if repository.syncStatus == .error {
            return .red
        }

        // Then check paper sync status
        switch repository.paperSyncStatus {
        case .inSync:
            return .green
        case .needsSync:
            return .yellow
        case .neverSynced, .noPapers:
            return .gray
        }
    }

    private var statusText: String {
        if repository.syncStatus == .error {
            return "Error"
        }

        return repository.paperSyncStatus.displayText
    }
}

#Preview {
    VStack(spacing: 16) {
        RepositoryCard(repository: .preview)
        RepositoryCard(repository: .previewOutdated)
        RepositoryCard(repository: .previewWithErrors)
        RepositoryCard(repository: .preview, isRefreshing: true)
    }
    .padding()
}
