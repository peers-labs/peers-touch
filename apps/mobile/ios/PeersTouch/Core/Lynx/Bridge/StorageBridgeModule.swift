import Foundation

struct StorageBridgeModule: BridgeModule {
    let moduleName = "storage"

    private let defaults: UserDefaults

    init(suiteName: String = "applet_storage") {
        self.defaults = UserDefaults(suiteName: suiteName) ?? .standard
    }

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "get":
            guard let key = params?["key"] as? String else {
                throw BridgeError.invalidParams("Missing 'key' parameter")
            }
            return defaults.string(forKey: key)

        case "set":
            guard let key = params?["key"] as? String,
                  let value = params?["value"] as? String else {
                throw BridgeError.invalidParams("Missing 'key' or 'value' parameter")
            }
            defaults.set(value, forKey: key)
            return nil

        case "remove":
            guard let key = params?["key"] as? String else {
                throw BridgeError.invalidParams("Missing 'key' parameter")
            }
            defaults.removeObject(forKey: key)
            return nil

        case "clear":
            if let bundleId = Bundle.main.bundleIdentifier {
                defaults.removePersistentDomain(forName: bundleId)
            }
            return nil

        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }
}
