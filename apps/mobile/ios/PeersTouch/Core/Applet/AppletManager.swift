import Foundation

struct AppletDiagnostic: Sendable {
    let source: String
    let issues: [String]
}

final class AppletManager: @unchecked Sendable {
    private var applets: [String: AppletInfo] = [:]
    private var sessions: [String: AppletBridgeSession] = [:]
    private var rejectedDiagnostics: [String: [String]] = [:]
    private let platformVersion = "0.1.0"
    private let parser = AppletManifestParser()
    private let bundleStorage: AppletBundleStorage
    private let bridgeDispatcher: BridgeDispatcher
    private let lock = NSLock()

    init(bundleStorage: AppletBundleStorage, bridgeDispatcher: BridgeDispatcher) {
        self.bundleStorage = bundleStorage
        self.bridgeDispatcher = bridgeDispatcher
    }

    func scanLocalApplets() -> [AppletManifest] {
        lock.withLock {
            rejectedDiagnostics.removeAll()
            applets.removeAll()
        }

        let cachedBundles = bundleStorage.listCachedBundles()
        var normalized: [AppletInfo] = []
        var seenIds = Set<String>()

        for manifest in cachedBundles {
            do {
                try parser.validate(manifest)
            } catch {
                lock.withLock {
                    rejectedDiagnostics[manifest.id] = [error.localizedDescription]
                }
                continue
            }

            guard !seenIds.contains(manifest.id) else {
                lock.withLock {
                    rejectedDiagnostics[manifest.id] = ["Duplicate applet ID: \(manifest.id)"]
                }
                continue
            }

            if let platforms = manifest.targetPlatforms, !platforms.contains(.mobile) {
                lock.withLock {
                    rejectedDiagnostics[manifest.id] = ["Applet does not target mobile platform"]
                }
                continue
            }

            seenIds.insert(manifest.id)
            let info = AppletInfo(
                manifest: manifest,
                main: manifest.load.entry,
                path: bundleStorage.bundlePath(for: manifest.id)?.path ?? ""
            )
            normalized.append(info)
        }

        lock.withLock {
            for info in normalized {
                applets[info.manifest.id] = info
            }
        }

        return normalized.map(\.manifest)
    }

    func loadApplet(id: String) throws -> AppletBridgeSession {
        let info: AppletInfo? = lock.withLock { applets[id] }

        guard let info else {
            let rejected: [String]? = lock.withLock { rejectedDiagnostics[id] }
            if let issues = rejected, !issues.isEmpty {
                throw AppletManagerError.loadFailed("Applet \(id) is invalid:\n\(issues.joined(separator: "\n"))")
            }
            throw AppletManagerError.appletNotFound(id)
        }

        if let minVersion = info.manifest.minPlatformVersion {
            guard AppletManifestParser.compareSemver(minVersion, platformVersion) <= 0 else {
                throw AppletManagerError.incompatibleVersion(
                    required: minVersion,
                    current: platformVersion
                )
            }
        }

        let existingSession: AppletBridgeSession? = lock.withLock { sessions[id] }
        if let existing = existingSession, existing.state != .unloaded, existing.state != .error {
            return existing
        }

        let session = AppletBridgeSession(manifest: info.manifest, dispatcher: bridgeDispatcher)
        session.transition(to: .loading)
        session.transition(to: .ready)

        lock.withLock {
            sessions[id] = session
        }

        return session
    }

    func unloadApplet(id: String) {
        lock.withLock {
            if let session = sessions[id] {
                session.transition(to: .unloaded)
            }
            sessions.removeValue(forKey: id)
        }
    }

    func getApplet(id: String) -> AppletBridgeSession? {
        lock.withLock { sessions[id] }
    }

    func getAppletInfo(id: String) -> AppletInfo? {
        lock.withLock { applets[id] }
    }

    func getLoadedApplets() -> [AppletBridgeSession] {
        lock.withLock {
            sessions.values.filter { $0.state != .unloaded && $0.state != .error }
        }
    }

    func getAvailableApplets() -> [AppletInfo] {
        lock.withLock { Array(applets.values) }
    }

    func getDiagnostics() -> [AppletDiagnostic] {
        lock.withLock {
            rejectedDiagnostics.map { AppletDiagnostic(source: $0.key, issues: $0.value) }
        }
    }

    func clear() {
        lock.withLock {
            sessions.values.forEach { $0.transition(to: .unloaded) }
            sessions.removeAll()
        }
    }
}

enum AppletManagerError: Error, Sendable {
    case appletNotFound(String)
    case incompatibleVersion(required: String, current: String)
    case loadFailed(String)
}
