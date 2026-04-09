import Foundation

final class AppletBridgeSession: @unchecked Sendable {
    let appletId: String
    let manifest: AppletManifest
    private let dispatcher: BridgeDispatcher
    private(set) var state: AppletState
    let loadedAt: Date
    private let grantedPermissions: Set<String>

    init(manifest: AppletManifest, dispatcher: BridgeDispatcher) {
        self.appletId = manifest.id
        self.manifest = manifest
        self.dispatcher = dispatcher
        self.state = .registered
        self.loadedAt = Date()
        self.grantedPermissions = Set(manifest.permissions)
    }

    func transition(to newState: AppletState) {
        self.state = newState
    }

    func dispatch(module: String, method: String, params: [String: Any]?) async -> BridgeResult {
        guard state != .unloaded else {
            return .error(
                code: BridgeErrorCode.executionFailed.rawValue,
                message: "BridgeSession for applet \(appletId) is unloaded"
            )
        }
        guard checkPermission(module: module) else {
            return .error(
                code: BridgeErrorCode.executionFailed.rawValue,
                message: "Applet \(appletId) lacks permission for module: \(module)"
            )
        }
        return await dispatcher.invoke(module: module, method: method, params: params)
    }

    func dispatch(api: String, params: [String: Any]?) async -> BridgeResult {
        guard state != .unloaded else {
            return .error(
                code: BridgeErrorCode.executionFailed.rawValue,
                message: "BridgeSession for applet \(appletId) is unloaded"
            )
        }
        let components = api.split(separator: ".", maxSplits: 1)
        if components.count == 2 {
            guard checkPermission(module: String(components[0])) else {
                return .error(
                    code: BridgeErrorCode.executionFailed.rawValue,
                    message: "Applet \(appletId) lacks permission for module: \(components[0])"
                )
            }
        }
        return await dispatcher.invoke(api: api, params: params)
    }

    private func checkPermission(module: String) -> Bool {
        if grantedPermissions.contains("*") { return true }
        return grantedPermissions.contains(module)
    }
}
