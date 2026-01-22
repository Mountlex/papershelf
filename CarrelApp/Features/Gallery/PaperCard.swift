import SwiftUI

struct PaperCard: View {
    let paper: Paper

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Thumbnail
            thumbnailView
                .frame(height: 200)
                .clipped()

            // Info section
            VStack(alignment: .leading, spacing: 6) {
                Text(paper.title ?? "Untitled")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)
                    .foregroundStyle(.primary)

                if let authors = paper.authors, !authors.isEmpty {
                    Text(authors)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                StatusBadge(status: paper.status)
            }
            .padding(12)
        }
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.1), radius: 8, y: 4)
    }

    @ViewBuilder
    private var thumbnailView: some View {
        if let thumbnailUrl = paper.thumbnailUrl, let url = URL(string: thumbnailUrl) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    Rectangle()
                        .fill(.quaternary)
                        .overlay {
                            ProgressView()
                        }

                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)

                case .failure:
                    placeholderView

                @unknown default:
                    placeholderView
                }
            }
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
            "authors": "John Doe, Jane Smith",
            "thumbnailUrl": null,
            "status": "synced",
            "isPublic": false,
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
            "authors": "Test Author",
            "thumbnailUrl": null,
            "status": "error",
            "isPublic": false,
            "createdAt": 1704067200000,
            "updatedAt": 1704067200000
        }
        """.data(using: .utf8)!)
    }
}
