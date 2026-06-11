import Foundation

protocol BridgeModule: Sendable {
    var moduleName: String { get }
    func handle(method: String, params: [String: Any]?) async throws -> Any?
}

enum BridgeError: Error, Sendable {
    case moduleNotFound(String)
    case methodNotFound(module: String, method: String)
    case invalidParams(String)
    case executionFailed(String)
}

enum BridgeResult {
    case success(Any?)
    case error(code: String, message: String)
}

enum BridgeErrorCode {
    static let moduleNotFound = "CAPABILITY_NOT_FOUND"
    static let methodNotFound = "CAPABILITY_NOT_FOUND"
    static let invalidParams = "INVALID_PARAMS"
    static let executionFailed = "CAPABILITY_FAILED"
}

final class BridgeDispatcher: @unchecked Sendable {
    private var modules: [String: any BridgeModule] = [:]
    private let lock = NSLock()

    init() {}

    init(modules: [any BridgeModule]) {
        for module in modules {
            self.modules[module.moduleName] = module
        }
    }

    func register(module: any BridgeModule) {
        lock.withLock {
            modules[module.moduleName] = module
        }
    }

    func invoke(module: String, method: String, params: [String: Any]?) async -> BridgeResult {
        let bridgeModule: (any BridgeModule)? = lock.withLock {
            modules[module]
        }

        guard let bridgeModule else {
            return .error(
                code: BridgeErrorCode.moduleNotFound,
                message: "Bridge module not found: \(module)"
            )
        }

        do {
            let result = try await bridgeModule.handle(method: method, params: params)
            return .success(result)
        } catch {
            return .error(
                code: BridgeErrorCode.executionFailed,
                message: "Bridge execution failed: \(module).\(method) - \(error.localizedDescription)"
            )
        }
    }

    func invoke(api: String, params: [String: Any]?) async -> BridgeResult {
        let components = api.split(separator: ".", maxSplits: 1)
        guard components.count == 2 else {
            return .error(
                code: BridgeErrorCode.invalidParams,
                message: "API format must be 'module.method', got: \(api)"
            )
        }
        let moduleName = String(components[0])
        let methodName = String(components[1])
        return await invoke(module: moduleName, method: methodName, params: params)
    }

    func hasModule(_ moduleName: String) -> Bool {
        lock.withLock { modules[moduleName] != nil }
    }

    func getRegisteredModules() -> Set<String> {
        lock.withLock { Set(modules.keys) }
    }
}
