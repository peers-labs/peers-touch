import Foundation

struct AppletInfo {
    let manifest: AppletManifest
    let bundleURL: URL
}

struct AppletDiagnostic {
    let source: String
    let issues: [String]
}

final class AppletBundleStorage {
    private let fileManager: FileManager
    private let searchRoots: [URL]

    init(fileManager: FileManager = .default, searchRoots: [URL]? = nil) {
        self.fileManager = fileManager
        if let searchRoots {
            self.searchRoots = searchRoots
        } else {
            var roots: [URL] = []
            if let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
                roots.append(applicationSupport.appendingPathComponent("PeersTouch/Applets", isDirectory: true))
            }
            if let resourceRoot = Bundle.main.resourceURL {
                roots.append(resourceRoot.appendingPathComponent("applets", isDirectory: true))
            }
            self.searchRoots = roots
        }
    }

    func listCachedBundles() -> [AppletInfo] {
        searchRoots.flatMap { root in
            listBundleDirectories(in: root).compactMap { bundleURL in
                try? loadBundle(at: bundleURL)
            }
        }
    }

    func loadBundle(appletId: String) throws -> AppletInfo {
        for root in searchRoots {
            for bundleURL in listBundleDirectories(in: root) {
                let info = try loadBundle(at: bundleURL)
                if info.manifest.id == appletId {
                    return info
                }
            }
        }
        throw AppletError.bundleNotFound(appletId)
    }

    func bundleURL(for appletId: String) -> URL? {
        try? loadBundle(appletId: appletId).bundleURL
    }

    private func listBundleDirectories(in root: URL) -> [URL] {
        guard let children = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        return children.filter { child in
            let manifestURL = child.appendingPathComponent("manifest.json")
            return fileManager.fileExists(atPath: manifestURL.path)
        }
    }

    private func loadBundle(at bundleURL: URL) throws -> AppletInfo {
        let manifestURL = bundleURL.appendingPathComponent("manifest.json")
        let data = try Data(contentsOf: manifestURL)
        let manifest = try JSONDecoder().decode(AppletManifest.self, from: data)
        return AppletInfo(manifest: manifest, bundleURL: bundleURL)
    }
}
