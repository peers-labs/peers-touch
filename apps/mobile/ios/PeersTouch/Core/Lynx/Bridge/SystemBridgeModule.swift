import UIKit

struct SystemBridgeModule: BridgeModule {
    let moduleName = "system"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "getInfo":
            return await systemInfo()
        case "getLocale":
            return getLocale()
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    @MainActor
    private func systemInfo() -> [String: Any] {
        let screen = UIScreen.main.bounds
        return [
            "platform": "mobile",
            "os": "ios",
            "version": UIDevice.current.systemVersion,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
            "appName": "PeersTouch",
            "screenWidth": Int(screen.width),
            "screenHeight": Int(screen.height),
            "statusBarHeight": Int(UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first?.statusBarManager?.statusBarFrame.height ?? 0)
        ]
    }

    private func getLocale() -> [String: String] {
        let locale = Locale.current
        return [
            "language": locale.language.languageCode?.identifier ?? "",
            "country": locale.region?.identifier ?? "",
            "tag": locale.identifier
        ]
    }
}
