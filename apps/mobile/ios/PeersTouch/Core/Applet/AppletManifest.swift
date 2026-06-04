import Foundation

struct PlatformLoadConfig: Codable {
    let type: String
    let entry: String
}

struct AppletLoadMap: Codable {
    let desktop: PlatformLoadConfig?
    let android: PlatformLoadConfig?
    let ios: PlatformLoadConfig?
    let standalone: PlatformLoadConfig?
}

struct AppletBridgeConfig: Codable {
    let protocol_: String
    let version: String

    enum CodingKeys: String, CodingKey {
        case protocol_ = "protocol"
        case version
    }
}

struct AppletManifest: Codable {
    let id: String
    let name: String
    let version: String
    let description: String?
    let author: String
    let icon: String?
    let permissions: [String]
    let capabilities: [String]
    let targetPlatforms: [String]
    let load: AppletLoadMap
    let bridge: AppletBridgeConfig

    static let bridgeProtocol = "peers-touch.applet.bridge"
    static let validLoadTypes: Set<String> = ["lynx-native", "lynx-web", "web-spa"]
    static let validPlatforms: Set<String> = ["desktop", "android", "ios", "standalone"]

    var iosLoadConfig: PlatformLoadConfig? { load.ios }

    func validate() -> [String] {
        var issues: [String] = []

        if id.isEmpty { issues.append("id must not be empty") }
        if name.isEmpty { issues.append("name must not be empty") }
        if bridge.protocol_ != Self.bridgeProtocol {
            issues.append("bridge.protocol must be \(Self.bridgeProtocol)")
        }
        if load.ios == nil {
            issues.append("load.ios is required for iOS platform")
        } else if let iosConfig = load.ios {
            if !Self.validLoadTypes.contains(iosConfig.type) {
                issues.append("load.ios.type must be one of \(Self.validLoadTypes)")
            }
            if iosConfig.entry.isEmpty {
                issues.append("load.ios.entry must not be empty")
            }
        }

        return issues
    }
}
