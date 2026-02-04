import SwiftUI
import UIKit

struct ConfigurePaperSheet: View {
    let repository: Repository
    let filePath: String
    let onDismiss: () -> Void

    @State private var title: String
    @State private var compiler: Compiler = .pdflatex
    @State private var isAdding = false
    @State private var toastMessage: ToastMessage?
    @State private var keyboardHeight: CGFloat = 0
    @FocusState private var focusedField: Field?

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

    private enum Field {
        case title
    }

    var body: some View {
        NavigationStack {
            ZStack {
                GlassBackdrop()
                ScrollView {
                    VStack(spacing: 20) {
                        GlassSection {
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
                        }

                        GlassSection(title: "Paper Details") {
                            VStack(spacing: 12) {
                                TextField("Title", text: $title)
                                    .textFieldStyle(.roundedBorder)
                                    .focused($focusedField, equals: .title)

                                if isTexFile {
                                    Picker("Compiler", selection: $compiler) {
                                        ForEach(Compiler.allCases) { compiler in
                                            Text(compiler.displayName).tag(compiler)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                }
                            }
                        }

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
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.liquidGlass)
                        .disabled(!canAddPaper)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 20)
                }
                .scrollDismissesKeyboard(.interactively)
                .padding(.bottom, keyboardHeight)
                .animation(.easeInOut(duration: 0.2), value: keyboardHeight)
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
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { notification in
            guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            keyboardHeight = max(0, frame.height - 20)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
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
