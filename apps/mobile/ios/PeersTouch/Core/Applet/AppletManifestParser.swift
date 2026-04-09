import Foundation

enum AppletLoadType: String, Codable, Sendable {
    case lynx
}

struct AppletLoadConfig: Codable, Sendable, Hashable {
    let type: AppletLoadType
    let entry: String
}

struct AppletBridgeConfig: Codable, Sendable, Hashable {
    let version: Int
    let `protocol`: String
}

enum TargetPlatform: String, Codable, Sendable {
    case desktop
    case mobile
    case web
}

struct AppletManifest: Codable, Sendable, Hashable, Identifiable {
    let manifestVersion: Int
    let id: String
    let name: String
    let version: String
    let description: String
    let author: String
    let icon: String?
    let permissions: [String]
    let capabilities: [String]?
    let minPlatformVersion: String?
    let targetPlatforms: [TargetPlatform]?
    let load: AppletLoadConfig
    let bridge: AppletBridgeConfig
}

struct AppletInfo: Sendable {
    let manifest: AppletManifest
    let main: String
    let path: String
}

enum AppletManifestError: Error, Sendable {
    case invalidData
    case invalidManifestVersion(Int)
    case invalidId(String)
    case invalidVersion(String)
    case missingRequiredField(String)
    case invalidBridgeProtocol(String)
    case invalidLoadType(String)
    case incompatiblePlatform
    case duplicateId(String)
}

struct AppletManifestParser: Sendable {
    static let manifestVersion = 2
    static let bridgeProtocol = "peers-touch.applet.bridge.v2"
    static let manifestFileName = "applet.json"
    static let appletIdPattern = /^[a-z0-9][a-z0-9-]*$/
    static let semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z\-.]+)?(?:\+[0-9A-Za-z\-.]+)?$/

    func parse(data: Data) throws -> AppletManifest {
        let decoder = JSONDecoder()
        let manifest = try decoder.decode(AppletManifest.self, from: data)
        try validate(manifest)
        return manifest
    }

    func validate(_ manifest: AppletManifest) throws {
        guard manifest.manifestVersion == Self.manifestVersion else {
            throw AppletManifestError.invalidManifestVersion(manifest.manifestVersion)
        }

        guard manifest.id.wholeMatch(of: Self.appletIdPattern) != nil else {
            throw AppletManifestError.invalidId(manifest.id)
        }

        guard manifest.version.wholeMatch(of: Self.semverPattern) != nil else {
            throw AppletManifestError.invalidVersion(manifest.version)
        }

        guard !manifest.name.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw AppletManifestError.missingRequiredField("name")
        }

        guard !manifest.description.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw AppletManifestError.missingRequiredField("description")
        }

        guard !manifest.author.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw AppletManifestError.missingRequiredField("author")
        }

        guard manifest.bridge.protocol == Self.bridgeProtocol else {
            throw AppletManifestError.invalidBridgeProtocol(manifest.bridge.protocol)
        }

        guard manifest.bridge.version == Self.manifestVersion else {
            throw AppletManifestError.invalidManifestVersion(manifest.bridge.version)
        }

        guard manifest.load.type == .lynx else {
            throw AppletManifestError.invalidLoadType(manifest.load.type.rawValue)
        }

        guard !manifest.load.entry.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw AppletManifestError.missingRequiredField("load.entry")
        }

        if let minVersion = manifest.minPlatformVersion {
            guard minVersion.wholeMatch(of: Self.semverPattern) != nil else {
                throw AppletManifestError.invalidVersion(minVersion)
            }
        }
    }

    static func compareSemver(_ left: String, _ right: String) -> Int {
        func normalize(_ value: String) -> (Int, Int, Int) {
            let version = value.split(separator: "-").first ?? Substring(value)
            let parts = version.split(separator: ".").map { Int($0) ?? 0 }
            return (parts.count > 0 ? parts[0] : 0,
                    parts.count > 1 ? parts[1] : 0,
                    parts.count > 2 ? parts[2] : 0)
        }
        let l = normalize(left)
        let r = normalize(right)
        if l.0 != r.0 { return l.0 - r.0 }
        if l.1 != r.1 { return l.1 - r.1 }
        return l.2 - r.2
    }
}
