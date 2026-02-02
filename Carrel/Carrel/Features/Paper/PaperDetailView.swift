import SwiftUI
import PDFKit
import Combine

struct PaperDetailView: View {
    @State private var viewModel: PaperViewModel
    @State private var showingShareSheet = false
    @State private var showingEditSheet = false
    @State private var shareFileURL: URL?
    @State private var isPreparingShare = false
    @State private var subscriptionTask: Task<Void, Never>?
    @State private var pdfLoadError: String?
    @State private var showCopiedToast = false
    @State private var shareError: String?
    @Environment(\.dismiss) private var dismiss

    init(paper: Paper) {
        _viewModel = State(initialValue: PaperViewModel(paper: paper))
    }

    private func copyShareLink() {
        guard let slug = viewModel.paper.shareSlug else { return }
        UIPasteboard.general.string = "https://carrelapp.com/share/\(slug)"
        showCopiedToast = true
        HapticManager.success()
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
            #if DEBUG
            print("Failed to prepare share file: \(error)")
            #endif
            shareError = error.localizedDescription
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
                .accessibilityLabel("Done")
                .accessibilityHint("Close paper details")
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
                            Label("Share PDF", systemImage: "square.and.arrow.up")
                        }
                    }
                    .disabled(viewModel.paper.pdfUrl == nil || isPreparingShare)

                    Button {
                        showingEditSheet = true
                    } label: {
                        Label("Edit Details", systemImage: "pencil")
                    }

                    Divider()

                    if viewModel.paper.isPublic {
                        Section("Public Link") {
                            Button {
                                copyShareLink()
                            } label: {
                                Label("Copy Link", systemImage: "link")
                            }

                            Button(role: .destructive) {
                                Task {
                                    await viewModel.togglePublic()
                                }
                            } label: {
                                Label("Make Private", systemImage: "lock")
                            }
                        }
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
                .accessibilityLabel("More options")
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
        .alert("Share Failed", isPresented: .constant(shareError != nil)) {
            Button("OK") {
                shareError = nil
            }
        } message: {
            Text(shareError ?? "Failed to prepare PDF for sharing")
        }
        .overlay(alignment: .top) {
            if showCopiedToast {
                Text("Link copied!")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation {
                                showCopiedToast = false
                            }
                        }
                    }
                    .padding(.top, 8)
            }
        }
        .animation(.easeInOut, value: showCopiedToast)
        .task {
            await startSubscription()
        }
        .onDisappear {
            subscriptionTask?.cancel()
            subscriptionTask = nil
        }
    }

    private func startSubscription() async {
        let paperId = viewModel.paper.id
        subscriptionTask = Task {
            do {
                let publisher = ConvexService.shared.subscribeToPaper(id: paperId)
                for try await updatedPaper in publisher.values {
                    guard !Task.isCancelled else { break }
                    viewModel.onPaperUpdate(updatedPaper)
                }
            } catch {
                if !Task.isCancelled {
                    #if DEBUG
                    print("PaperDetailView: Subscription error: \(error)")
                    #endif
                }
            }
        }
    }

    @ViewBuilder
    private var pdfViewer: some View {
        if let pdfUrl = viewModel.paper.pdfUrl, let url = URL(string: pdfUrl) {
            PDFViewerWithOfflineCheck(url: url) { error in
                pdfLoadError = error
            }
            .alert("PDF Error", isPresented: .constant(pdfLoadError != nil)) {
                Button("OK") {
                    pdfLoadError = nil
                }
            } message: {
                Text(pdfLoadError ?? "Failed to load PDF")
            }
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
                    HStack(spacing: 6) {
                        Text(viewModel.paper.title ?? "Untitled")
                            .font(.headline)

                        if viewModel.paper.isPublic {
                            Image(systemName: "globe")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
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

/// Wrapper that checks offline status before showing PDF
struct PDFViewerWithOfflineCheck: View {
    let url: URL
    var onError: ((String) -> Void)?

    @State private var showOfflineMessage = false

    var body: some View {
        Group {
            if showOfflineMessage {
                // Offline and not cached
                ContentUnavailableView {
                    Label("Not Available Offline", systemImage: "wifi.slash")
                } description: {
                    Text("This PDF hasn't been downloaded yet. Connect to the internet to view it.")
                }
            } else {
                // Show the PDF viewer - it will call onError if offline and not cached
                PDFViewerContainer(url: url) { error in
                    // Check if this is a network error while offline
                    if !NetworkMonitor.shared.isConnected {
                        showOfflineMessage = true
                    } else {
                        onError?(error)
                    }
                }
            }
        }
        .task {
            // Pre-check: if offline and not cached, show message immediately
            let isOffline = !NetworkMonitor.shared.isConnected
            if isOffline {
                let isCached = await PDFCache.shared.isCached(url: url)
                if !isCached {
                    showOfflineMessage = true
                }
            }
        }
    }
}

struct PDFViewerContainer: UIViewRepresentable {
    let url: URL
    var onError: ((String) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        return pdfView
    }

    func updateUIView(_ pdfView: PDFView, context: Context) {
        // Cancel any existing load task
        context.coordinator.loadTask?.cancel()

        let errorHandler = onError
        // Start new load task
        context.coordinator.loadTask = Task {
            do {
                guard !Task.isCancelled else { return }
                let data = try await PDFCache.shared.fetchPDF(from: url)
                guard !Task.isCancelled else { return }
                if let document = PDFDocument(data: data) {
                    await MainActor.run {
                        guard !Task.isCancelled else { return }
                        pdfView.document = document
                    }
                } else {
                    await MainActor.run {
                        errorHandler?("Unable to open PDF. The file may be corrupted.")
                    }
                }
            } catch {
                if !Task.isCancelled {
                    await MainActor.run {
                        errorHandler?(error.localizedDescription)
                    }
                }
            }
        }
    }

    static func dismantleUIView(_ pdfView: PDFView, coordinator: Coordinator) {
        coordinator.loadTask?.cancel()
        coordinator.loadTask = nil
    }

    class Coordinator {
        var loadTask: Task<Void, Never>?
    }
}

struct EditPaperSheet: View {
    @Bindable var viewModel: PaperViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var title: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Paper Details") {
                    TextField("Title", text: $title)
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
                                title: title.isEmpty ? nil : title
                            )
                            dismiss()
                        }
                    }
                    .disabled(viewModel.isLoading)
                }
            }
            .onAppear {
                title = viewModel.paper.title ?? ""
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
