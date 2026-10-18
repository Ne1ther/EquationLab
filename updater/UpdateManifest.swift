import Foundation
import CryptoKit

public enum UpdateError: Error, Equatable {
    case invalidVersion, invalidManifest, invalidSignature, incompatibleSystem, checksumMismatch
    case http(Int), downloadTooLarge
}

public struct ReleaseVersion: Comparable, Equatable, Sendable {
    public let parts: [Int]
    public init(_ value: String) throws {
        let pieces = value.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count == 3, pieces.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }),
              pieces.allSatisfy({ Int($0) != nil }) else { throw UpdateError.invalidVersion }
        parts = pieces.map { Int($0)! }
    }
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.parts.lexicographicallyPrecedes(rhs.parts) }
}

public struct UpdateManifest: Codable, Equatable, Sendable {
    public let schema: String
    public let version: String
    public let build: Int
    public let architecture: String
    public let minimumMacOS: String
    public let filename: String
    public let size: Int64
    public let sha256: String
    public let url: URL
    public let notesZH: String
    public let notesEN: String
    public var releaseURL: URL { URL(string: "https://github.com/Ne1ther/EquationLab/releases/tag/v\(version)")! }

    public static func verified(_ data: Data, publicKey: String = UpdateTrust.publicKey) throws -> Self {
        struct Envelope: Decodable { let schema: String; let payload: String; let signature: String }
        guard data.count <= 128 * 1024, let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.schema == "equationlab.signed-update.v1",
              let payload = Data(base64Encoded: envelope.payload), let signature = Data(base64Encoded: envelope.signature),
              let keyData = Data(base64Encoded: publicKey), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              key.isValidSignature(signature, for: payload) else { throw UpdateError.invalidSignature }
        guard let manifest = try? JSONDecoder().decode(Self.self, from: payload) else { throw UpdateError.invalidManifest }
        try manifest.validate()
        return manifest
    }

    public func validate() throws {
        _ = try ReleaseVersion(version)
        _ = try osVersion()
        let expectedFilename = "Equation-Lab-\(version).pkg"
        guard schema == "equationlab.update.v1", build > 0, architecture == "arm64",
              filename == expectedFilename, size > 0, size <= 500 * 1024 * 1024,
              sha256.count == 64, sha256.allSatisfy({ "0123456789abcdef".contains($0) }),
              url.absoluteString == "https://github.com/Ne1ther/EquationLab/releases/download/v\(version)/\(expectedFilename)",
              notesZH.count <= 8000, notesEN.count <= 8000 else { throw UpdateError.invalidManifest }
    }

    private func osVersion() throws -> ReleaseVersion {
        let parts = minimumMacOS.split(separator: ".", omittingEmptySubsequences: false)
        guard (2...3).contains(parts.count) else { throw UpdateError.invalidManifest }
        return try ReleaseVersion(parts.count == 2 ? minimumMacOS + ".0" : minimumMacOS)
    }
    public func isNewer(than version: String, build installedBuild: Int) throws -> Bool {
        let remote = try ReleaseVersion(self.version), local = try ReleaseVersion(version)
        return remote > local || remote == local && build > installedBuild
    }
    public func supports(os: OperatingSystemVersion) throws -> Bool {
        let current = try ReleaseVersion("\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)")
        return current >= (try osVersion())
    }
    public func verifyPackage(at file: URL) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == size else { throw UpdateError.checksumMismatch }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
        guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == sha256 else { throw UpdateError.checksumMismatch }
    }
}

public struct GitHubRelease: Decodable, Sendable {
    public struct Asset: Decodable, Sendable {
        public let name: String
        public let size: Int64
        public let browser_download_url: URL
    }
    public let tag_name: String
    public let draft: Bool
    public let prerelease: Bool
    public let assets: [Asset]
    public func manifestURL() throws -> URL? {
        guard !draft, !prerelease, tag_name.hasPrefix("v") else { throw UpdateError.invalidManifest }
        _ = try ReleaseVersion(String(tag_name.dropFirst()))
        let matches = assets.filter { $0.name == "EquationLab-update.json" }
        guard matches.count <= 1 else { throw UpdateError.invalidManifest }
        guard let asset = matches.first else { return nil }
        guard asset.size > 0, asset.size <= 128 * 1024,
              asset.browser_download_url.absoluteString == "https://github.com/Ne1ther/EquationLab/releases/download/\(tag_name)/EquationLab-update.json" else { throw UpdateError.invalidManifest }
        return asset.browser_download_url
    }
}

public enum UpdateNetworkPolicy {
    public static func allows(_ url: URL) -> Bool {
        url.scheme == "https" && url.user == nil && url.password == nil && (url.port == nil || url.port == 443) &&
        ["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].contains(url.host?.lowercased() ?? "")
    }
    public static func shouldCheck(lastAttempt: Date?, now: Date = Date()) -> Bool {
        guard let lastAttempt else { return true }
        return now.timeIntervalSince(lastAttempt) >= 24 * 60 * 60 || lastAttempt > now
    }
}
