import UIKit

struct DeviceBridgeModule: BridgeModule {
    let moduleName = "device"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "getClipboardContent":
            return await getClipboardContent()
        case "setClipboardContent":
            guard let content = params?["content"] as? String else {
                throw BridgeError.invalidParams("Missing 'content' parameter")
            }
            await setClipboardContent(content)
            return nil
        case "getDeviceInfo":
            return await getDeviceInfo()
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    @MainActor
    private func getClipboardContent() -> String? {
        UIPasteboard.general.string
    }

    @MainActor
    private func setClipboardContent(_ content: String) {
        UIPasteboard.general.string = content
    }

    @MainActor
    private func getDeviceInfo() -> [String: Any] {
        [
            "brand": "Apple",
            "model": UIDevice.current.model,
            "manufacturer": "Apple",
            "osVersion": UIDevice.current.systemVersion,
            "name": UIDevice.current.name
        ]
    }
}
