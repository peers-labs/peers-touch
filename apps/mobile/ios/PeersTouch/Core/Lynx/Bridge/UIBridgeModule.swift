import UIKit

enum ToastType: String, Sendable {
    case success
    case error
    case info
    case warning
}

struct UIBridgeModule: BridgeModule {
    let moduleName = "ui"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "showToast":
            guard let content = params?["content"] as? String else {
                throw BridgeError.invalidParams("Missing 'content' parameter")
            }
            let duration = params?["duration"] as? TimeInterval ?? 2000
            let typeString = params?["type"] as? String ?? "info"
            let type = ToastType(rawValue: typeString) ?? .info
            await showToast(content: content, duration: duration, type: type)
            return nil
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    @MainActor
    private func showToast(content: String, duration: TimeInterval, type: ToastType) {
        _ = content
        _ = duration
        _ = type
    }
}
