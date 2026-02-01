import Foundation

struct RepositoryFile: Codable, Identifiable, Equatable {
    let name: String
    let path: String
    let type: FileType
    let size: Int?

    var id: String { path }

    enum FileType: String, Codable {
        case file
        case dir
    }

    var isDirectory: Bool { type == .dir }
    var isTexFile: Bool { name.hasSuffix(".tex") }
    var isPdfFile: Bool { name.hasSuffix(".pdf") }
    var isSelectable: Bool { isTexFile || isPdfFile }
}

// MARK: - Preview Support

extension RepositoryFile {
    static var previewDirectory: RepositoryFile {
        RepositoryFile(name: "chapters", path: "chapters", type: .dir, size: nil)
    }

    static var previewTexFile: RepositoryFile {
        RepositoryFile(name: "main.tex", path: "main.tex", type: .file, size: 12345)
    }

    static var previewPdfFile: RepositoryFile {
        RepositoryFile(name: "paper.pdf", path: "paper.pdf", type: .file, size: 524288)
    }
}
