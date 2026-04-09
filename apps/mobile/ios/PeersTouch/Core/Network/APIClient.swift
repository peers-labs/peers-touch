import Foundation

enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
    case patch = "PATCH"
}

enum APIError: Error, Sendable {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, data: Data)
    case decodingError(Error)
    case networkError(Error)
    case unauthorized
}

final class APIClient: @unchecked Sendable {
    let baseURL: URL
    private let session: URLSession
    private let authInterceptor: AuthInterceptor
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL, authInterceptor: AuthInterceptor) {
        self.baseURL = baseURL
        self.authInterceptor = authInterceptor

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: configuration)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    func request<T: Decodable & Sendable>(
        endpoint: String,
        method: HTTPMethod = .get,
        body: (any Encodable & Sendable)? = nil,
        headers: [String: String]? = nil
    ) async throws -> T {
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method.rawValue
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            urlRequest.httpBody = try encoder.encode(body)
        }

        headers?.forEach { key, value in
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }

        urlRequest = authInterceptor.intercept(request: urlRequest)

        let (data, response) = try await session.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.httpError(statusCode: httpResponse.statusCode, data: data)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    func requestVoid(
        endpoint: String,
        method: HTTPMethod = .post,
        body: (any Encodable & Sendable)? = nil,
        headers: [String: String]? = nil
    ) async throws {
        let _: EmptyResponse = try await request(
            endpoint: endpoint,
            method: method,
            body: body,
            headers: headers
        )
    }
}

private struct EmptyResponse: Decodable, Sendable {}
