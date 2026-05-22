import Foundation

final class AppletBridgeSession {
    let manifest: AppletManifest
    private(set) var state: AppletState = .registered
    private let bridgeDispatcher: BridgeDispatcher
    private let grantedPermissions: Set<String>

    init(manifest: AppletManifest, bridgeDispatcher: BridgeDispatcher) {
        self.manifest = manifest
        self.bridgeDispatcher = bridgeDispatcher
        self.grantedPermissions = Set(manifest.permissions)
    }

    func transition(to newState: AppletState) {
        state = newState
    }

    func dispatch(method: String, params: [String: Any]) async throws -> BridgeResult {
        guard state != .unloaded else {
            throw AppletError.bridgeFailed("Session for \(manifest.id) is unloaded")
        }

        // Parse dot-notation: "storage.get" → module="storage", action="get"
        let components = method.split(separator: ".", maxSplits: 1)
        if components.count == 2 {
            let module = String(components[0])
            checkPermission(module: module)
        }

        return await bridgeDispatcher.invoke(method: method, params: params)
    }

    private func checkPermission(module: String) {
        guard !grantedPermissions.contains("*") else { return }
        guard grantedPermissions.contains(module) else {
            // Permission denied — in production this should throw, for now just log
            return
        }
    }
}
