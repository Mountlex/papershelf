import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    let email: String
    let name: String?
    let avatarUrl: String?
    let providers: [String]

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case email, name, avatarUrl, providers
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        email = try container.decode(String.self, forKey: .email)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        providers = try container.decodeIfPresent([String].self, forKey: .providers) ?? []
    }
}
