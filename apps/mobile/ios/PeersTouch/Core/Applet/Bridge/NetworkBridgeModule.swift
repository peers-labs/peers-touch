import Foundation

final class NetworkBridgeModule: BridgeModule {
    let moduleName = "network"
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func handle(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "request":
            return try await request(params: params)
        default:
            throw BridgeModuleError.unknownMethod("\(moduleName).\(method)")
        }
    }

    private func request(params: [String: Any]) async throws -> [String: Any] {
        guard let urlString = params["url"] as? String,
              let url = URL(string: urlString) else {
            throw BridgeModuleError.invalidParams("url is required")
        }

        let httpMethod = (params["method"] as? String)?.uppercased() ?? "GET"
        let headers = params["headers"] as? [String: String] ?? [:]
        let body = params["body"] as? String
        let timeout = params["timeout"] as? TimeInterval ?? 30.0

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = httpMethod
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        if let body = body {
            request.httpBody = body.data(using: .utf8)
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw BridgeModuleError.executionFailed("Invalid response type")
        }

        let responseHeaders = httpResponse.allHeaderFields as? [String: String] ?? [:]
        let responseBody = String(data: data, encoding: .utf8) ?? ""

        return [
            "status": httpResponse.statusCode,
            "headers": responseHeaders,
            "body": responseBody
        ]
    }
}
