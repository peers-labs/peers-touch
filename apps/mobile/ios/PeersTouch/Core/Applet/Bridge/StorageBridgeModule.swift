import Foundation

final class StorageBridgeModule: BridgeModule {
    let moduleName = "storage"
    private let defaults: UserDefaults

    init(suiteName: String = "com.peerstouch.applet.storage") {
        self.defaults = UserDefaults(suiteName: suiteName) ?? .standard
    }

    func handle(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "get":
            guard let key = params["key"] as? String else {
                throw BridgeModuleError.invalidParams("key is required")
            }
            return defaults.string(forKey: key)

        case "set":
            guard let key = params["key"] as? String else {
                throw BridgeModuleError.invalidParams("key is required")
            }
            guard let value = params["value"] as? String else {
                throw BridgeModuleError.invalidParams("value is required")
            }
            defaults.set(value, forKey: key)
            return nil

        case "remove":
            guard let key = params["key"] as? String else {
                throw BridgeModuleError.invalidParams("key is required")
            }
            defaults.removeObject(forKey: key)
            return nil

        case "clear":
            if let bundleId = Bundle.main.bundleIdentifier {
                defaults.removePersistentDomain(forName: bundleId)
            }
            return nil

        default:
            throw BridgeModuleError.unknownMethod("\(moduleName).\(method)")
        }
    }
}

enum BridgeModuleError: Error {
    case invalidParams(String)
    case unknownMethod(String)
    case executionFailed(String)
}
