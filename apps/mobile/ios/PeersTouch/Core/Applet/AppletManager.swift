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
    private var applets: [String: AppletInfo] = [:]
    private var rejectedDiagnostics: [String: [String]] = [:]
    private let bundleStorage: AppletBundleStorage
    private let bridgeDispatcher: BridgeDispatcher

    init(bundleStorage: AppletBundleStorage, bridgeDispatcher: BridgeDispatcher) {
        self.bundleStorage = bundleStorage
        self.bridgeDispatcher = bridgeDispatcher
    }

    func scanLocalApplets() -> [AppletManifest] {
        rejectedDiagnostics.removeAll()
        applets.removeAll()

        for info in bundleStorage.listCachedBundles() {
            let manifest = info.manifest
            if applets[manifest.id] != nil {
                rejectedDiagnostics[manifest.id] = ["Duplicate applet ID: \(manifest.id)"]
                continue
            }
            if !manifest.targets.contains("ios") {
                rejectedDiagnostics[manifest.id] = ["Applet does not target iOS platform"]
                continue
            }
            let issues = manifest.validate()
            if !issues.isEmpty {
                rejectedDiagnostics[manifest.id] = issues
                continue
            }
            applets[manifest.id] = info
        }

        return applets.values.map(\.manifest)
    }

    func loadApplet(id: String) throws -> AppletBridgeSession {
        if applets.isEmpty {
            _ = scanLocalApplets()
        }

        guard let info = applets[id] else {
            if let issues = rejectedDiagnostics[id] {
                throw AppletError.invalidManifest(issues.joined(separator: "; "))
            }
            throw AppletError.bundleNotFound(id)
        }

        return try loadApplet(manifest: info.manifest)
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

    func getAppletInfo(_ id: String) -> AppletInfo? {
        applets[id]
    }

    func getBundleURL(_ id: String) -> URL? {
        applets[id]?.bundleURL ?? bundleStorage.bundleURL(for: id)
    }

    func getApplet(_ id: String) -> AppletBridgeSession? {
        sessions[id]
    }

    func unloadApplet(_ id: String) {
        sessions[id]?.transition(to: .unloaded)
        sessions.removeValue(forKey: id)
    }

    func getDiagnostics() -> [AppletDiagnostic] {
        rejectedDiagnostics.map { source, issues in
            AppletDiagnostic(source: source, issues: issues)
        }
    }
}

enum AppletError: Error {
    case invalidManifest(String)
    case bundleNotFound(String)
    case bridgeFailed(String)
}
