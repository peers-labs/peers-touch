import Foundation

final class AppletBundleStorage: @unchecked Sendable {
    private let fileManager = FileManager.default
    private let bundleDirectory: URL
    private let parser = AppletManifestParser()

    init() {
        let cacheDir = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
        self.bundleDirectory = cacheDir.appendingPathComponent("applet-bundles", isDirectory: true)
        try? fileManager.createDirectory(at: bundleDirectory, withIntermediateDirectories: true)
    }

    func bundlePath(for appletId: String) -> URL? {
        let path = bundleDirectory.appendingPathComponent(appletId, isDirectory: true)
        return fileManager.fileExists(atPath: path.path) ? path : nil
    }

    func downloadBundle(appletId: String, from url: URL) async throws -> URL {
        let destination = bundleDirectory.appendingPathComponent(appletId, isDirectory: true)
        try? fileManager.removeItem(at: destination)
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)

        let (tempURL, _) = try await URLSession.shared.download(from: url)
        let bundleFile = destination.appendingPathComponent(url.lastPathComponent)
        try fileManager.moveItem(at: tempURL, to: bundleFile)

        return destination
    }

    func deleteBundle(appletId: String) throws {
        let path = bundleDirectory.appendingPathComponent(appletId, isDirectory: true)
        if fileManager.fileExists(atPath: path.path) {
            try fileManager.removeItem(at: path)
        }
    }

    func listCachedBundles() -> [AppletManifest] {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: bundleDirectory,
            includingPropertiesForKeys: nil,
            options: .skipsHiddenFiles
        ) else {
            return []
        }

        return contents.compactMap { dir in
            let manifestURL = dir.appendingPathComponent(AppletManifestParser.manifestFileName)
            guard let data = try? Data(contentsOf: manifestURL),
                  let manifest = try? parser.parse(data: data) else {
                return nil
            }
            return manifest
        }
    }
}
