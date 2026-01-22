import Foundation

struct Paper: Codable, Identifiable, Equatable {
    let id: String
    let title: String?
    let authors: String?
    let pdfUrl: String?
    let thumbnailUrl: String?
    let status: PaperStatus
    let isPublic: Bool
    let shareSlug: String?
    let repositoryId: String?
    let trackedFileId: String?
    let lastSyncedAt: Date?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case title, authors, pdfUrl, thumbnailUrl, status
        case isPublic, shareSlug, repositoryId, trackedFileId
        case lastSyncedAt, createdAt, updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        authors = try container.decodeIfPresent(String.self, forKey: .authors)
        pdfUrl = try container.decodeIfPresent(String.self, forKey: .pdfUrl)
        thumbnailUrl = try container.decodeIfPresent(String.self, forKey: .thumbnailUrl)
        status = try container.decodeIfPresent(PaperStatus.self, forKey: .status) ?? .unknown
        isPublic = try container.decodeIfPresent(Bool.self, forKey: .isPublic) ?? false
        shareSlug = try container.decodeIfPresent(String.self, forKey: .shareSlug)
        repositoryId = try container.decodeIfPresent(String.self, forKey: .repositoryId)
        trackedFileId = try container.decodeIfPresent(String.self, forKey: .trackedFileId)

        // Parse timestamps (Convex sends milliseconds)
        if let lastSyncedMs = try container.decodeIfPresent(Double.self, forKey: .lastSyncedAt) {
            lastSyncedAt = Date(timeIntervalSince1970: lastSyncedMs / 1000)
        } else {
            lastSyncedAt = nil
        }

        if let createdMs = try container.decodeIfPresent(Double.self, forKey: .createdAt) {
            createdAt = Date(timeIntervalSince1970: createdMs / 1000)
        } else {
            createdAt = Date()
        }

        if let updatedMs = try container.decodeIfPresent(Double.self, forKey: .updatedAt) {
            updatedAt = Date(timeIntervalSince1970: updatedMs / 1000)
        } else {
            updatedAt = Date()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(authors, forKey: .authors)
        try container.encodeIfPresent(pdfUrl, forKey: .pdfUrl)
        try container.encodeIfPresent(thumbnailUrl, forKey: .thumbnailUrl)
        try container.encode(status, forKey: .status)
        try container.encode(isPublic, forKey: .isPublic)
        try container.encodeIfPresent(shareSlug, forKey: .shareSlug)
        try container.encodeIfPresent(repositoryId, forKey: .repositoryId)
        try container.encodeIfPresent(trackedFileId, forKey: .trackedFileId)
    }
}

enum PaperStatus: String, Codable {
    case synced
    case pending
    case building
    case error
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        self = PaperStatus(rawValue: value) ?? .unknown
    }
}

struct PapersResponse: Codable {
    let papers: [Paper]

    init(from decoder: Decoder) throws {
        // The API returns an array directly
        let container = try decoder.singleValueContainer()
        papers = try container.decode([Paper].self)
    }
}
