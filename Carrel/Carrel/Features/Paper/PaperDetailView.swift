import SwiftUI
import PDFKit

struct PaperDetailView: View {
    @State private var viewModel: PaperViewModel
    @State private var showingShareSheet = false
    @State private var showingEditSheet = false
    @State private var shareFileURL: URL?
    @State private var isPreparingShare = false
    @Environment(\.dismiss) private var dismiss

    init(paper: Paper) {
        _viewModel = State(initialValue: PaperViewModel(paper: paper))
    }

    private func prepareShareFile() async {
        guard let pdfUrlString = viewModel.paper.pdfUrl,
              let pdfUrl = URL(string: pdfUrlString) else { return }

        isPreparingShare = true
        defer { isPreparingShare = false }

        do {
            // Download the PDF
            let data = try await PDFCache.shared.fetchPDF(from: pdfUrl)

            // Create filename from paper title
            let title = viewModel.paper.title ?? "Paper"
            let sanitizedTitle = title
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: ":", with: "-")
            let filename = "\(sanitizedTitle).pdf"

            // Save to temp directory
            let tempDir = FileManager.default.temporaryDirectory
            let fileURL = tempDir.appendingPathComponent(filename)
            try data.write(to: fileURL)

            shareFileURL = fileURL
            showingShareSheet = true
        } catch {
            print("Failed to prepare share file: \(error)")
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // PDF Viewer
            pdfViewer
                .frame(maxHeight: .infinity)

            // Info panel with glass effect
            infoPanel
        }
        .navigationTitle(viewModel.paper.title ?? "Paper")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") {
                    dismiss()
                }
            }

            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        Task {
                            await prepareShareFile()
                        }
                    } label: {
                        if isPreparingShare {
                            Label("Preparing...", systemImage: "ellipsis")
                        } else {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                    .disabled(viewModel.paper.pdfUrl == nil || isPreparingShare)

                    Button {
                        showingEditSheet = true
                    } label: {
                        Label("Edit Details", systemImage: "pencil")
                    }

                    Divider()

                    Button {
                        Task {
                            await viewModel.build()
                        }
                    } label: {
                        Label("Sync", systemImage: "arrow.clockwise")
                    }

                    Button {
                        Task {
                            await viewModel.build(force: true)
                        }
                    } label: {
                        Label("Force Rebuild", systemImage: "hammer")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingShareSheet, onDismiss: {
            // Clean up temp file after sharing
            if let fileURL = shareFileURL {
                try? FileManager.default.removeItem(at: fileURL)
                shareFileURL = nil
            }
        }) {
            if let fileURL = shareFileURL {
                ShareSheet(items: [fileURL])
            }
        }
        .sheet(isPresented: $showingEditSheet) {
            EditPaperSheet(viewModel: viewModel)
        }
        .alert("Error", isPresented: .constant(viewModel.error != nil)) {
            Button("OK") {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.error ?? "Unknown error")
        }
    }

    @ViewBuilder
    private var pdfViewer: some View {
        if let pdfUrl = viewModel.paper.pdfUrl, let url = URL(string: pdfUrl) {
            PDFViewerContainer(url: url)
        } else {
            ContentUnavailableView {
                Label("No PDF", systemImage: "doc.text.fill")
            } description: {
                Text("This paper doesn't have a PDF yet.")
            } actions: {
                Button("Build PDF") {
                    Task {
                        await viewModel.build()
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private var infoPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.paper.title ?? "Untitled")
                        .font(.headline)

                    if let authors = viewModel.paper.authors, !authors.isEmpty {
                        Text(authors)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if viewModel.isBuilding || viewModel.paper.buildStatus == "building" {
                    HStack(spacing: 6) {
                        ProgressView()
                            .scaleEffect(0.7)
                        Text(viewModel.paper.compilationProgress ?? "Building...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                } else {
                    // Use the rich status indicator for detail view
                    PaperStatusIndicator(paper: viewModel.paper)
                }
            }

            // Last commit info
            if viewModel.paper.lastAffectedCommitTime != nil || viewModel.paper.lastAffectedCommitAuthor != nil {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if let commitTime = viewModel.paper.lastAffectedCommitTime {
                        Text(commitTime.relativeFormatted)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let author = viewModel.paper.lastAffectedCommitAuthor {
                        Text("by \(author)")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    Spacer()
                }
            }
        }
        .padding(12)
        .glassEffect(.regular, in: Rectangle())
    }
}

struct PDFViewerContainer: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical

        // Load PDF asynchronously (with caching)
        Task {
            do {
                let data = try await PDFCache.shared.fetchPDF(from: url)
                if let document = PDFDocument(data: data) {
                    await MainActor.run {
                        pdfView.document = document
                    }
                }
            } catch {
                print("Failed to load PDF: \(error)")
            }
        }

        return pdfView
    }

    func updateUIView(_ pdfView: PDFView, context: Context) {}
}

struct EditPaperSheet: View {
    @Bindable var viewModel: PaperViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var title: String = ""
    @State private var authors: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Paper Details") {
                    TextField("Title", text: $title)
                    TextField("Authors", text: $authors)
                }
            }
            .navigationTitle("Edit Paper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await viewModel.updateMetadata(
                                title: title.isEmpty ? nil : title,
                                authors: authors.isEmpty ? nil : authors
                            )
                            dismiss()
                        }
                    }
                    .disabled(viewModel.isLoading)
                }
            }
            .onAppear {
                title = viewModel.paper.title ?? ""
                authors = viewModel.paper.authors ?? ""
            }
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
