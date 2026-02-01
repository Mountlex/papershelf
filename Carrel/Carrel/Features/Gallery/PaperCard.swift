import SwiftUI

struct PaperCard: View {
    let paper: Paper
    var isSyncing: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Thumbnail - content layer, no glass
            thumbnailView
                .frame(height: 200)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16))

            // Info section with glass backdrop
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 6) {
                    Text(paper.title ?? "Untitled")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(2)
                        .foregroundStyle(.primary)

                    Spacer()

                    if isSyncing {
                        ProgressView()
                            .scaleEffect(0.6)
                            .padding(.top, 2)
                    } else {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 8, height: 8)
                            .padding(.top, 4)
                    }
                }
            }
            .padding(12)
        }
        .glassEffect(
            .regular.interactive(),
            in: RoundedRectangle(cornerRadius: 16)
        )
    }

    @ViewBuilder
    private var thumbnailView: some View {
        if let thumbnailUrl = paper.thumbnailUrl, let url = URL(string: thumbnailUrl) {
            CachedThumbnail(url: url)
        } else {
            placeholderView
        }
    }

    private var placeholderView: some View {
        Rectangle()
            .fill(.quaternary)
            .overlay {
                Image(systemName: "doc.text")
                    .font(.largeTitle)
                    .foregroundStyle(.tertiary)
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

struct CachedThumbnail: View {
    let url: URL
    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var loadFailed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else if isLoading {
                Rectangle()
                    .fill(.quaternary)
                    .overlay {
                        ProgressView()
                    }
            } else {
                Rectangle()
                    .fill(.quaternary)
                    .overlay {
                        Image(systemName: "doc.text")
                            .font(.largeTitle)
                            .foregroundStyle(.tertiary)
                    }
            }
        }
        .task {
            await loadThumbnail()
        }
    }

    private func loadThumbnail() async {
        do {
            let thumbnail = try await ThumbnailCache.shared.fetchThumbnail(from: url)
            image = thumbnail
        } catch {
            loadFailed = true
        }
        isLoading = false
    }
}

#Preview {
    HStack {
        PaperCard(paper: Paper.preview)
            .frame(width: 180)

        PaperCard(paper: Paper.previewError)
            .frame(width: 180)
    }
    .padding()
}

extension Paper {
    static var preview: Paper {
        try! JSONDecoder().decode(Paper.self, from: """
        {
            "_id": "1",
            "title": "A Long Paper Title That Might Wrap",
            "thumbnailUrl": null,
            "isUpToDate": true,
            "isPublic": false,
            "lastAffectedCommitTime": 1704067200000,
            "lastAffectedCommitAuthor": "John Doe",
            "createdAt": 1704067200000,
            "updatedAt": 1704067200000
        }
        """.data(using: .utf8)!)
    }

    static var previewError: Paper {
        try! JSONDecoder().decode(Paper.self, from: """
        {
            "_id": "2",
            "title": "Paper with Error",
            "thumbnailUrl": null,
            "buildStatus": "error",
            "isPublic": false,
            "createdAt": 1704067200000,
            "updatedAt": 1704067200000
        }
        """.data(using: .utf8)!)
    }
}
