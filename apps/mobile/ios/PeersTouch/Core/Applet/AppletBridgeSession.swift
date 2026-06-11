import Foundation

final class AppletBridgeSession {
    let manifest: AppletManifest
    let sessionId: String
    private(set) var state: AppletState = .registered
    private let bridgeDispatcher: BridgeDispatcher
    private let grantedPermissions: Set<String>

    init(manifest: AppletManifest, bridgeDispatcher: BridgeDispatcher) {
        self.manifest = manifest
        self.sessionId = "ios:\(manifest.id):\(Int(Date().timeIntervalSince1970 * 1000))"
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

        // Keep permission checks aligned with canonical method names such as storage.get.
        let components = method.split(separator: ".", maxSplits: 1)
        if components.count == 2 {
            let module = String(components[0])
            guard hasPermission(module: module, api: method) else {
                return .error(
                    code: "PERMISSION_DENIED",
                    message: "Applet \(manifest.id) lacks permission for capability: \(method)"
                )
            }
        }

        return await bridgeDispatcher.invoke(api: method, params: params)
    }

    private func hasPermission(module: String, api: String) -> Bool {
        grantedPermissions.contains("*")
            || grantedPermissions.contains(api)
            || grantedPermissions.contains(module)
            || grantedPermissions.contains { permission in
                permission.hasSuffix(".*") && api.hasPrefix(String(permission.dropLast()))
            }
    }
}

extension AppletBridgeSession {
    func makeBridgeResponse(requestId: String, result: BridgeResult) -> [String: Any] {
        var response: [String: Any] = [
            "protocol": AppletManifest.bridgeProtocol,
            "kind": "response",
            "appletId": manifest.id,
            "sessionId": sessionId,
            "requestId": requestId,
        ]
        switch result {
        case .success(let data):
            response["ok"] = true
            response["result"] = data ?? NSNull()
        case .error(let code, let message):
            response["ok"] = false
            response["error"] = [
                "code": code,
                "message": message,
                "requestId": requestId,
            ]
        }
        return response
    }
}
