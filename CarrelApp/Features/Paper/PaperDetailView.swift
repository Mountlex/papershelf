import SwiftUI
import PDFKit

struct PaperDetailView: View {
    @State private var viewModel: PaperViewModel
    @State private var showingShareSheet = false
    @State private var showingEditSheet = false
    @Environment(\.dismiss) private var dismiss

    init(paper: Paper, authManager: AuthManager) {
        _viewModel = State(initialValue: PaperViewModel(paper: paper, authManager: authManager))
    }

    var body: some View {
        VStack(spacing: 0) {
            // PDF Viewer
            pdfViewer
                .frame(maxHeight: .infinity)

            // Info panel
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
                        showingShareSheet = true
                    } label: {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .disabled(viewModel.paper.pdfUrl == nil)

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
        .sheet(isPresented: $showingShareSheet) {
            if let pdfUrl = viewModel.paper.pdfUrl, let url = URL(string: pdfUrl) {
                ShareSheet(items: [url])
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
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(viewModel.paper.title ?? "Untitled")
                        .font(.headline)

                    if let authors = viewModel.paper.authors, !authors.isEmpty {
                        Text(authors)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                StatusBadge(status: viewModel.paper.status)
            }

            HStack(spacing: 16) {
                // Public toggle
                Button {
                    Task {
                        await viewModel.togglePublic()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: viewModel.paper.isPublic ? "globe" : "lock")
                        Text(viewModel.paper.isPublic ? "Public" : "Private")
                    }
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                }
                .disabled(viewModel.isTogglingPublic)

                if viewModel.isBuilding {
                    HStack(spacing: 6) {
                        ProgressView()
                            .scaleEffect(0.7)
                        Text("Building...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if let lastSynced = viewModel.paper.lastSyncedAt {
                    Text("Synced \(lastSynced.relativeFormatted)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial)
    }
}

struct PDFViewerContainer: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical

        // Load PDF asynchronously
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
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
