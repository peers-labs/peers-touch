import Foundation

enum AppletState {
    case registered
    case loading
    case ready
    case running
    case suspended
    case unloaded
}

final class AppletManager {
    private var sessions: [String: AppletBridgeSession] = [:]
    private let bridgeDispatcher: BridgeDispatcher

    init(bridgeDispatcher: BridgeDispatcher) {
        self.bridgeDispatcher = bridgeDispatcher
    }

    func loadApplet(manifest: AppletManifest) throws -> AppletBridgeSession {
        let issues = manifest.validate()
        guard issues.isEmpty else {
            throw AppletError.invalidManifest(issues.joined(separator: "; "))
        }

        if let existing = sessions[manifest.id] {
            return existing
        }

        let session = AppletBridgeSession(
            manifest: manifest,
            bridgeDispatcher: bridgeDispatcher
        )
        session.transition(to: .ready)
        sessions[manifest.id] = session
        return session
    }

    func getApplet(_ id: String) -> AppletBridgeSession? {
        sessions[id]
    }

    func unloadApplet(_ id: String) {
        sessions[id]?.transition(to: .unloaded)
        sessions.removeValue(forKey: id)
    }
}

enum AppletError: Error {
    case invalidManifest(String)
    case bundleNotFound(String)
    case bridgeFailed(String)
}
