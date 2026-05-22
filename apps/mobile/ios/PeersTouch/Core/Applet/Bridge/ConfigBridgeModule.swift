import Foundation

final class ConfigBridgeModule: BridgeModule {
    let moduleName = "config"
    private var configs: [String: String] = [:]

    func setConfig(key: String, value: String) {
        configs[key] = value
    }

    func handle(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "get":
            guard let key = params["key"] as? String else {
                throw BridgeModuleError.invalidParams("key is required")
            }
            return configs[key]
        default:
            throw BridgeModuleError.unknownMethod("\(moduleName).\(method)")
        }
    }
}
