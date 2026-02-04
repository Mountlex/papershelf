import Foundation

struct Repository: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let gitUrl: String
    let provider: RepositoryProvider
    let defaultBranch: String
    let syncStatus: RepositorySyncStatus
    let lastSyncedAt: Date?
    let lastCommitHash: String?
    let lastCommitTime: Date?
    let lastCommitAuthor: String?
    let backgroundRefreshEnabled: Bool
    // Enriched fields from backend query
    let paperSyncStatus: PaperSyncStatus
    let paperCount: Int
    let papersWithErrors: Int

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, gitUrl, provider, defaultBranch, syncStatus
        case lastSyncedAt, lastCommitHash, lastCommitTime, lastCommitAuthor
        case paperSyncStatus, paperCount, papersWithErrors
        case backgroundRefreshEnabled
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        gitUrl = try container.decode(String.self, forKey: .gitUrl)
        provider = try container.decode(RepositoryProvider.self, forKey: .provider)
        defaultBranch = try container.decode(String.self, forKey: .defaultBranch)
        syncStatus = try container.decode(RepositorySyncStatus.self, forKey: .syncStatus)
        paperSyncStatus = try container.decode(PaperSyncStatus.self, forKey: .paperSyncStatus)
        paperCount = try container.decode(Int.self, forKey: .paperCount)
        papersWithErrors = try container.decode(Int.self, forKey: .papersWithErrors)

        // Parse timestamps (Convex sends milliseconds)
        if let lastSyncedMs = try container.decodeIfPresent(Double.self, forKey: .lastSyncedAt) {
            lastSyncedAt = Date(timeIntervalSince1970: lastSyncedMs / 1000)
        } else {
            lastSyncedAt = nil
        }

        lastCommitHash = try container.decodeIfPresent(String.self, forKey: .lastCommitHash)

        if let lastCommitMs = try container.decodeIfPresent(Double.self, forKey: .lastCommitTime) {
            lastCommitTime = Date(timeIntervalSince1970: lastCommitMs / 1000)
        } else {
            lastCommitTime = nil
        }

        lastCommitAuthor = try container.decodeIfPresent(String.self, forKey: .lastCommitAuthor)

        backgroundRefreshEnabled = try container.decodeIfPresent(
            Bool.self,
            forKey: .backgroundRefreshEnabled
        ) ?? false
    }
}

enum RepositoryProvider: String, Codable {
    case github
    case gitlab
    case selfhostedGitlab = "selfhosted-gitlab"
    case overleaf
    case generic

    var displayName: String {
        switch self {
        case .github: return "GitHub"
        case .gitlab: return "GitLab"
        case .selfhostedGitlab: return "Self-hosted GitLab"
        case .overleaf: return "Overleaf"
        case .generic: return "Git"
        }
    }

    var iconName: String {
        switch self {
        case .github: return "network"
        case .gitlab: return "server.rack"
        case .selfhostedGitlab: return "server.rack"
        case .overleaf: return "leaf"
        case .generic: return "externaldrive.connected.to.line.below"
        }
    }
}

enum RepositorySyncStatus: String, Codable {
    case idle
    case syncing
    case error
}

enum PaperSyncStatus: String, Codable {
    case noPapers = "no_papers"
    case inSync = "in_sync"
    case needsSync = "needs_sync"
    case neverSynced = "never_synced"

    var displayText: String {
        switch self {
        case .noPapers: return "No papers"
        case .inSync: return "Up to date"
        case .needsSync: return "Outdated"
        case .neverSynced: return "Not synced"
        }
    }
}

// MARK: - Preview Support

extension Repository {
    static var preview: Repository {
        try! JSONDecoder().decode(Repository.self, from: """
        {
            "_id": "repo1",
            "name": "my-latex-paper",
            "gitUrl": "https://github.com/user/my-latex-paper",
            "provider": "github",
            "defaultBranch": "main",
            "syncStatus": "idle",
            "lastSyncedAt": 1704067200000,
            "lastCommitHash": "abc123",
            "lastCommitTime": 1704067200000,
            "lastCommitAuthor": "John Doe",
            "paperSyncStatus": "in_sync",
            "paperCount": 2,
            "papersWithErrors": 0
        }
        """.data(using: .utf8)!)
    }

    static var previewOutdated: Repository {
        try! JSONDecoder().decode(Repository.self, from: """
        {
            "_id": "repo2",
            "name": "thesis-project",
            "gitUrl": "https://gitlab.com/user/thesis-project",
            "provider": "gitlab",
            "defaultBranch": "main",
            "syncStatus": "idle",
            "lastSyncedAt": 1704067200000,
            "lastCommitHash": "def456",
            "lastCommitTime": 1704067200000,
            "lastCommitAuthor": "Jane Smith",
            "paperSyncStatus": "needs_sync",
            "paperCount": 1,
            "papersWithErrors": 0
        }
        """.data(using: .utf8)!)
    }

    static var previewWithErrors: Repository {
        try! JSONDecoder().decode(Repository.self, from: """
        {
            "_id": "repo3",
            "name": "overleaf-paper",
            "gitUrl": "https://git.overleaf.com/123abc",
            "provider": "overleaf",
            "defaultBranch": "master",
            "syncStatus": "error",
            "lastSyncedAt": 1704067200000,
            "paperSyncStatus": "needs_sync",
            "paperCount": 3,
            "papersWithErrors": 1
        }
        """.data(using: .utf8)!)
    }
}
