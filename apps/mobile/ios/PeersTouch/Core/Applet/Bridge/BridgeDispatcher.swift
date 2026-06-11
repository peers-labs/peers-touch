import Foundation

enum BridgeResult {
    case success(Any?)
    case error(code: String, message: String)
}

final class BridgeDispatcher {
    private var modules: [String: BridgeModule] = [:]

    func register(module: BridgeModule) {
        modules[module.moduleName] = module
    }

    func invoke(method: String, params: [String: Any]) async -> BridgeResult {
        let components = method.split(separator: ".", maxSplits: 1)
        guard components.count == 2 else {
            return .error(code: "INVALID_PARAMS", message: "Method format must be 'module.action', got: \(method)")
        }

        let moduleName = String(components[0])
        let action = String(components[1])

        guard let module = modules[moduleName] else {
            return .error(code: "CAPABILITY_NOT_FOUND", message: "Module not found: \(moduleName)")
        }

        do {
            let result = try await module.handle(method: action, params: params)
            return .success(result)
        } catch {
            return .error(code: "CAPABILITY_FAILED", message: "\(moduleName).\(action) - \(error.localizedDescription)")
        }
    }
}
