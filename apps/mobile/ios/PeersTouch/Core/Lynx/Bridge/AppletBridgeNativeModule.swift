import Foundation
import Lynx

@objc(AppletBridgeNativeModule)
final class AppletBridgeNativeModule: NSObject, LynxModule {
    private let session: AppletBridgeSession

    @objc static var name: String {
        "bridge"
    }

    @objc static var methodLookup: [String: String] {
        ["invoke": "invoke:"]
    }

    @objc(initWithParam:)
    init(param: Any) {
        guard let session = param as? AppletBridgeSession else {
            fatalError("AppletBridgeNativeModule requires AppletBridgeSession param")
        }
        self.session = session
        super.init()
    }

    @objc override init() {
        fatalError("AppletBridgeNativeModule requires AppletBridgeSession param")
    }

    @objc(invoke:)
    func invoke(_ payload: Any) -> String {
        var requestId = "ios-\(Int(Date().timeIntervalSince1970 * 1000))"

        guard let request = parseRequest(payload) else {
            return errorEnvelope(
                requestId: requestId,
                code: "INVALID_PARAMS",
                message: "Applet bridge invoke requires an object or JSON string payload"
            )
        }

        guard let method = request["method"] as? String, !method.isEmpty else {
            return errorEnvelope(
                requestId: requestId,
                code: "INVALID_PARAMS",
                message: "Applet bridge invoke requires method"
            )
        }

        let params = request["params"] as? [String: Any] ?? [:]
        requestId = extractRequestId(from: params) ?? requestId

        let box = InvocationResultBox()
        let semaphore = DispatchSemaphore(value: 0)
        Task {
            do {
                box.result = try await session.dispatch(method: method, params: params)
            } catch AppletError.bridgeFailed(let message) {
                box.result = .error(code: "INVALID_SESSION", message: message)
            } catch {
                box.result = .error(code: "CAPABILITY_FAILED", message: error.localizedDescription)
            }
            semaphore.signal()
        }
        semaphore.wait()

        switch box.result {
        case .success(let value):
            recordRuntimeE2E(method: method, requestId: requestId, result: .success(value))
            return responseEnvelope(requestId: requestId, result: value)
        case .error(let code, let message):
            recordRuntimeE2E(method: method, requestId: requestId, result: .error(code: code, message: message))
            return errorEnvelope(requestId: requestId, code: code, message: message)
        case nil:
            return errorEnvelope(
                requestId: requestId,
                code: "CAPABILITY_FAILED",
                message: "Applet bridge invocation did not produce a result"
            )
        }
    }

    private func recordRuntimeE2E(method: String, requestId: String, result: BridgeResult) {
        guard ProcessInfo.processInfo.environment["PEERS_APPLET_IOS_RUNTIME_E2E"] == "1",
              let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return
        }

        let directory = applicationSupport.appendingPathComponent("PeersTouch/AppletRuntimeE2E", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let safeMethod = method
            .map { character in
                character.isLetter || character.isNumber || character == "." ? character : "-"
            }
            .reduce(into: "") { result, character in
                result.append(character)
            }
        let fileURL = directory.appendingPathComponent("\(safeMethod).json")

        var payload: [String: Any] = [
            "protocol": AppletManifest.bridgeProtocol,
            "kind": "runtime-e2e",
            "appletId": session.manifest.id,
            "sessionId": session.sessionId,
            "requestId": requestId,
            "method": method,
        ]
        switch result {
        case .success:
            payload["ok"] = true
        case .error(let code, let message):
            payload["ok"] = false
            payload["error"] = [
                "code": code,
                "message": message,
            ]
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else {
            return
        }
        try? data.write(to: fileURL, options: [.atomic])
    }

    private func parseRequest(_ payload: Any) -> [String: Any]? {
        if let dictionary = payload as? [String: Any] {
            return dictionary
        }
        if let dictionary = payload as? NSDictionary {
            return dictionaryToSwift(dictionary)
        }
        if let raw = payload as? String {
            guard let data = raw.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let dictionary = object as? [String: Any] else {
                return nil
            }
            return dictionary
        }
        return nil
    }

    private func extractRequestId(from params: [String: Any]) -> String? {
        guard let options = params["options"] as? [String: Any] ?? dictionaryToSwift(params["options"] as? NSDictionary),
              let requestId = options["requestId"] as? String,
              !requestId.isEmpty else {
            return nil
        }
        return requestId
    }

    private func responseEnvelope(requestId: String, result: Any?) -> String {
        var response = baseEnvelope(requestId: requestId, ok: true)
        response["result"] = jsonCompatible(result)
        return serialize(response)
    }

    private func errorEnvelope(requestId: String, code: String, message: String) -> String {
        var response = baseEnvelope(requestId: requestId, ok: false)
        response["error"] = [
            "code": code,
            "message": message,
            "requestId": requestId,
        ]
        return serialize(response)
    }

    private func baseEnvelope(requestId: String, ok: Bool) -> [String: Any] {
        [
            "protocol": AppletManifest.bridgeProtocol,
            "kind": "response",
            "appletId": session.manifest.id,
            "sessionId": session.sessionId,
            "requestId": requestId,
            "ok": ok,
        ]
    }

    private func serialize(_ response: [String: Any]) -> String {
        let compatible = jsonCompatible(response)
        guard JSONSerialization.isValidJSONObject(compatible),
              let data = try? JSONSerialization.data(withJSONObject: compatible, options: []),
              let raw = String(data: data, encoding: .utf8) else {
            return "{\"protocol\":\"\(AppletManifest.bridgeProtocol)\",\"kind\":\"response\",\"appletId\":\"\(session.manifest.id)\",\"sessionId\":\"\(session.sessionId)\",\"requestId\":\"serialization-error\",\"ok\":false,\"error\":{\"code\":\"CAPABILITY_FAILED\",\"message\":\"Failed to serialize applet bridge response\",\"requestId\":\"serialization-error\"}}"
        }
        return raw
    }

    private func jsonCompatible(_ value: Any?) -> Any {
        switch value {
        case nil:
            return NSNull()
        case let value as NSNull:
            return value
        case let value as String:
            return value
        case let value as Bool:
            return value
        case let value as NSNumber:
            return value
        case let value as [String: Any]:
            return jsonCompatibleDictionary(value)
        case let value as NSDictionary:
            return jsonCompatibleDictionary(dictionaryToSwift(value) ?? [:])
        case let value as [Any]:
            return value.map(jsonCompatible)
        case let value as NSArray:
            return value.map(jsonCompatible)
        default:
            return String(describing: value)
        }
    }

    private func jsonCompatibleDictionary(_ dictionary: [String: Any]) -> [String: Any] {
        dictionary.reduce(into: [String: Any]()) { result, element in
            result[element.key] = jsonCompatible(element.value)
        }
    }

    private func dictionaryToSwift(_ dictionary: NSDictionary?) -> [String: Any]? {
        guard let dictionary else { return nil }
        var result: [String: Any] = [:]
        for (key, value) in dictionary {
            guard let key = key as? String else { continue }
            result[key] = value
        }
        return result
    }
}

private final class InvocationResultBox: @unchecked Sendable {
    var result: BridgeResult?
}
