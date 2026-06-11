import Foundation

struct PlatformLoadConfig: Codable {
    let type: String
    let entry: String
}

struct AppletLoadMap: Codable {
    let desktop: PlatformLoadConfig?
    let android: PlatformLoadConfig?
    let ios: PlatformLoadConfig?
    let harmony: PlatformLoadConfig?
    let web: PlatformLoadConfig?
    let standalone: PlatformLoadConfig?
}

struct AppletBridgeConfig: Codable {
    let protocol_: String
    let version: String?

    enum CodingKeys: String, CodingKey {
        case protocol_ = "protocol"
        case version
    }
}

struct AppletEntryMap: Codable {
    let lynx: String
    let standalone: String?
}

struct AppletServiceDeclaration: Codable {
    let id: String
    let kind: String
    let binding: String
    let allowedMethods: [String]
    let allowedPaths: [String]
    let streaming: Bool?
}

struct AppletSkillDeclaration: Codable {
    let id: String
    let inputSchema: String
    let streaming: Bool?
}

struct PackageIntegrity: Codable {
    let algorithm: String
    let files: [String: String]
}

struct AppletManifest: Codable {
    let id: String
    let name: String?
    let version: String
    let description: String?
    let author: String?
    let icon: String?
    let permissions: [String]
    let capabilities: [String]
    let targets: [String]
    let targetPlatforms: [String]?
    let entries: AppletEntryMap
    let load: AppletLoadMap
    let bridge: AppletBridgeConfig
    let services: [AppletServiceDeclaration]
    let skills: [AppletSkillDeclaration]
    let integrity: PackageIntegrity

    static let bridgeProtocol = "peers-touch.applet.bridge"
    static let validPlatforms: Set<String> = ["desktop", "android", "ios", "harmony", "web", "standalone"]
    static let serviceBindings: Set<String> = ["host-resolved", "station-resolved", "dev-override"]
    static let loadTypesByPlatform: [String: String] = [
        "desktop": "lynx-web",
        "android": "lynx-native",
        "ios": "lynx-native",
        "harmony": "lynx-native",
        "web": "lynx-web",
        "standalone": "web-spa",
    ]

    var iosLoadConfig: PlatformLoadConfig? { load.ios }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case version
        case description
        case author
        case icon
        case permissions
        case capabilities
        case targets
        case targetPlatforms
        case entries
        case load
        case bridge
        case services
        case skills
        case integrity
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        version = try container.decode(String.self, forKey: .version)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        author = try container.decodeIfPresent(String.self, forKey: .author)
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        permissions = try container.decode([String].self, forKey: .permissions)
        capabilities = try container.decodeIfPresent([String].self, forKey: .capabilities) ?? []
        targetPlatforms = try container.decodeIfPresent([String].self, forKey: .targetPlatforms)
        targets = try container.decodeIfPresent([String].self, forKey: .targets) ?? targetPlatforms ?? []
        entries = try container.decode(AppletEntryMap.self, forKey: .entries)
        load = try container.decode(AppletLoadMap.self, forKey: .load)
        bridge = try container.decode(AppletBridgeConfig.self, forKey: .bridge)
        services = try container.decodeIfPresent([AppletServiceDeclaration].self, forKey: .services) ?? []
        skills = try container.decodeIfPresent([AppletSkillDeclaration].self, forKey: .skills) ?? []
        integrity = try container.decode(PackageIntegrity.self, forKey: .integrity)
    }

    func validate() -> [String] {
        var issues: [String] = []

        if id.isEmpty { issues.append("id must not be empty") }
        if version.isEmpty { issues.append("version must not be empty") }
        if targets.isEmpty {
            issues.append("targets must not be empty")
        }
        for target in targets where !Self.validPlatforms.contains(target) {
            issues.append("targets contains invalid value: \(target)")
        }
        if !targets.contains("ios") {
            issues.append("Applet does not target iOS platform")
        }
        if entries.lynx.isEmpty {
            issues.append("entries.lynx must not be empty")
        }
        if bridge.protocol_ != Self.bridgeProtocol {
            issues.append("bridge.protocol must be \(Self.bridgeProtocol)")
        }
        if permissions.isEmpty {
            issues.append("permissions must not be empty")
        }
        for target in targets {
            guard let loadConfig = loadConfig(for: target) else {
                issues.append("load.\(target) is required for every target")
                continue
            }
            if loadConfig.type != Self.loadTypesByPlatform[target] {
                issues.append("load.\(target).type must be \(Self.loadTypesByPlatform[target] ?? "")")
            }
            if loadConfig.entry.isEmpty {
                issues.append("load.\(target).entry must not be empty")
            }
        }
        for service in services {
            if service.id.isEmpty { issues.append("services.id must not be empty") }
            if service.kind != "http" { issues.append("services.kind must be http") }
            if !Self.serviceBindings.contains(service.binding) {
                issues.append("services.binding must be one of \(Self.serviceBindings)")
            }
            if service.allowedMethods.isEmpty { issues.append("services.allowedMethods must not be empty") }
            if service.allowedPaths.isEmpty { issues.append("services.allowedPaths must not be empty") }
        }
        if permissions.contains("network.request") && services.isEmpty {
            issues.append("network.request permission requires at least one service declaration")
        }
        if integrity.algorithm != "sha256" {
            issues.append("integrity.algorithm must be sha256")
        }
        if !integrity.files.keys.contains(entries.lynx) {
            issues.append("integrity.files must include entries.lynx")
        }
        for skill in skills {
            if skill.id.isEmpty { issues.append("skills.id must not be empty") }
            if skill.inputSchema.isEmpty { issues.append("skills.inputSchema must not be empty") }
            if !integrity.files.keys.contains(skill.inputSchema) {
                issues.append("integrity.files must include skill input schema: \(skill.inputSchema)")
            }
        }

        return issues
    }

    private func loadConfig(for target: String) -> PlatformLoadConfig? {
        switch target {
        case "desktop": return load.desktop
        case "android": return load.android
        case "ios": return load.ios
        case "harmony": return load.harmony
        case "web": return load.web
        case "standalone": return load.standalone
        default: return nil
        }
    }
}
