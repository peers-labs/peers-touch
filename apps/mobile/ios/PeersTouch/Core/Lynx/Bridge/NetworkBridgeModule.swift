import Foundation

struct NetworkBridgeModule: BridgeModule {
    let moduleName = "network"

    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: configuration)
    }

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "request":
            return try await handleRequest(params: params)
        case "download":
            return try await handleDownload(params: params)
        case "upload":
            return try await handleUpload(params: params)
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    private func handleRequest(params: [String: Any]?) async throws -> [String: Any] {
        guard let urlString = params?["url"] as? String,
              let url = URL(string: urlString) else {
            throw BridgeError.invalidParams("Missing or invalid 'url' parameter")
        }

        var request = URLRequest(url: url)
        request.httpMethod = (params?["method"] as? String) ?? "GET"

        if let headers = params?["headers"] as? [String: String] {
            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        }

        if let data = params?["data"] {
            request.httpBody = try JSONSerialization.data(withJSONObject: data)
            if request.value(forHTTPHeaderField: "Content-Type") == nil {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }

        if let timeout = params?["timeout"] as? TimeInterval {
            request.timeoutInterval = timeout / 1000
        }

        let (data, response) = try await session.data(for: request)
        let httpResponse = response as? HTTPURLResponse

        let responseBody: Any
        if let json = try? JSONSerialization.jsonObject(with: data) {
            responseBody = json
        } else {
            responseBody = String(data: data, encoding: .utf8) ?? ""
        }

        var responseHeaders: [String: String] = [:]
        httpResponse?.allHeaderFields.forEach { key, value in
            responseHeaders[String(describing: key)] = String(describing: value)
        }

        return [
            "data": responseBody,
            "status": httpResponse?.statusCode ?? 0,
            "headers": responseHeaders
        ]
    }

    private func handleDownload(params: [String: Any]?) async throws -> [String: Any] {
        guard let urlString = params?["url"] as? String,
              let url = URL(string: urlString) else {
            throw BridgeError.invalidParams("Missing or invalid 'url' parameter")
        }

        var request = URLRequest(url: url)
        if let headers = params?["headers"] as? [String: String] {
            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        }

        let (tempURL, response) = try await session.download(for: request)
        let httpResponse = response as? HTTPURLResponse

        let destinationPath: URL
        if let filePath = params?["filePath"] as? String {
            destinationPath = URL(fileURLWithPath: filePath)
        } else {
            destinationPath = FileManager.default.temporaryDirectory.appendingPathComponent(url.lastPathComponent)
        }

        try? FileManager.default.removeItem(at: destinationPath)
        try FileManager.default.moveItem(at: tempURL, to: destinationPath)

        let fileSize = (try? FileManager.default.attributesOfItem(atPath: destinationPath.path)[.size] as? Int) ?? 0

        return [
            "filePath": destinationPath.path,
            "statusCode": httpResponse?.statusCode ?? 0,
            "fileSize": fileSize
        ]
    }

    private func handleUpload(params: [String: Any]?) async throws -> [String: Any] {
        guard let urlString = params?["url"] as? String,
              let url = URL(string: urlString),
              let filePath = params?["filePath"] as? String,
              let name = params?["name"] as? String else {
            throw BridgeError.invalidParams("Missing required upload parameters")
        }

        let fileURL = URL(fileURLWithPath: filePath)
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        if let headers = params?["headers"] as? [String: String] {
            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        }

        var body = Data()
        if let formData = params?["formData"] as? [String: String] {
            for (key, value) in formData {
                body.append("--\(boundary)\r\n".data(using: .utf8)!)
                body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
                body.append("\(value)\r\n".data(using: .utf8)!)
            }
        }

        let fileData = try Data(contentsOf: fileURL)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        let httpResponse = response as? HTTPURLResponse

        let responseBody: Any
        if let json = try? JSONSerialization.jsonObject(with: data) {
            responseBody = json
        } else {
            responseBody = String(data: data, encoding: .utf8) ?? ""
        }

        return [
            "data": responseBody,
            "statusCode": httpResponse?.statusCode ?? 0
        ]
    }
}
