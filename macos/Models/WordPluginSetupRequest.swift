import Foundation

struct WordPluginSetupRequest: Decodable {
    let schema: String
    let app: String
    let reason: String

    static func load(from file: URL, for application: URL) -> WordPluginSetupRequest? {
        guard let values = try? FileManager.default.attributesOfItem(atPath: file.path),
              values[.type] as? FileAttributeType == .typeRegular,
              let size = values[.size] as? NSNumber, size.intValue > 0, size.intValue <= 4096,
              let data = try? Data(contentsOf: file), data.count <= 4096,
              let request = try? JSONDecoder().decode(Self.self, from: data),
              request.schema == "equationlab.word-setup-pending.v1",
              request.reason == "WORD_SETTINGS_ACCESS_DENIED",
              request.app == application.standardizedFileURL.path else { return nil }
        return request
    }
}
