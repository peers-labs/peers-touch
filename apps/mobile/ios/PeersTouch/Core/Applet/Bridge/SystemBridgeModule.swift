import Foundation
import UIKit

final class SystemBridgeModule: BridgeModule {
    let moduleName = "system"

    func handle(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "getInfo":
            return [
                "platform": "ios",
                "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
                "appName": Bundle.main.infoDictionary?["CFBundleDisplayName"] as? String ?? "PeersTouch"
            ]
        default:
            throw BridgeModuleError.unknownMethod("\(moduleName).\(method)")
        }
    }
}
