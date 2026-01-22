import SwiftUI

struct GlassCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .shadow(color: .black.opacity(0.1), radius: 10, y: 5)
    }
}

struct GlassSection<Content: View>: View {
    let title: String?
    let content: Content

    init(title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title = title {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }

            GlassCard {
                content
                    .padding()
            }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        GlassCard {
            VStack {
                Text("Glass Card")
                    .font(.headline)
                Text("With some content")
                    .foregroundStyle(.secondary)
            }
            .padding()
        }

        GlassSection(title: "Section Title") {
            Text("Section content goes here")
        }
    }
    .padding()
    .background(Color.gray.opacity(0.3))
}
