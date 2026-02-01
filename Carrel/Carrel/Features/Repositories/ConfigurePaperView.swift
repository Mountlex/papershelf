import SwiftUI

struct ConfigurePaperSheet: View {
    let repository: Repository
    let filePath: String
    let onDismiss: () -> Void

    @State private var title: String
    @State private var compiler: Compiler = .pdflatex
    @State private var isAdding = false
    @State private var toastMessage: ToastMessage?

    @Environment(\.dismiss) private var dismiss

    init(repository: Repository, filePath: String, onDismiss: @escaping () -> Void) {
        self.repository = repository
        self.filePath = filePath
        self.onDismiss = onDismiss

        // Auto-populate title from filename
        let filename = filePath.split(separator: "/").last.map(String.init) ?? filePath
        if let dotIndex = filename.lastIndex(of: ".") {
            self._title = State(initialValue: String(filename[..<dotIndex]))
        } else {
            self._title = State(initialValue: filename)
        }
    }

    private var isTexFile: Bool {
        filePath.hasSuffix(".tex")
    }

    private var canAddPaper: Bool {
        !title.isEmpty && !isAdding
    }

    var body: some View {
        NavigationStack {
            Form {
                // File info section
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: isTexFile ? "doc.text.fill" : "doc.fill")
                            .font(.title2)
                            .foregroundStyle(isTexFile ? .green : .red)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(filePath.split(separator: "/").last.map(String.init) ?? filePath)
                                .font(.headline)

                            Text(filePath)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, 4)
                }

                // Configuration section
                Section("Paper Details") {
                    TextField("Title", text: $title)

                    if isTexFile {
                        Picker("Compiler", selection: $compiler) {
                            ForEach(Compiler.allCases) { compiler in
                                Text(compiler.displayName).tag(compiler)
                            }
                        }
                    }
                }

                // Add button section
                Section {
                    Button {
                        Task {
                            await addPaper()
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if isAdding {
                                ProgressView()
                                    .scaleEffect(0.8)
                                    .padding(.trailing, 8)
                            }
                            Text(isAdding ? "Adding..." : "Add Paper")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(!canAddPaper)
                }
            }
            .navigationTitle("Add Paper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .overlay(alignment: .top) {
                ToastContainer(message: $toastMessage)
                    .padding(.top, 8)
            }
        }
    }

    private func addPaper() async {
        guard canAddPaper else { return }

        isAdding = true

        do {
            let pdfSourceType = isTexFile ? "compile" : "committed"
            let compilerValue = isTexFile ? compiler.rawValue : nil

            let result = try await ConvexService.shared.addTrackedFile(
                repositoryId: repository.id,
                filePath: filePath,
                title: title,
                pdfSourceType: pdfSourceType,
                compiler: compilerValue
            )

            // Trigger build in the background (don't wait)
            let paperId = result.paperId
            Task {
                try? await ConvexService.shared.buildPaper(id: paperId)
            }

            // Dismiss immediately after paper is created
            dismiss()
            onDismiss()
        } catch {
            let message = error.localizedDescription.contains("already exists")
                ? "File already tracked"
                : "Failed to add paper"
            toastMessage = ToastMessage(text: message, type: .error)
            print("ConfigurePaperSheet: Failed to add paper: \(error)")
            isAdding = false
        }
    }
}

#Preview {
    ConfigurePaperSheet(repository: .preview, filePath: "src/main.tex", onDismiss: {})
}
