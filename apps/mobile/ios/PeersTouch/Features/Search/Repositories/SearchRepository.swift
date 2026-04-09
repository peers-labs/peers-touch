import Foundation

final class SearchRepository: Sendable {
    private let apiClient: APIClient

    init(apiClient: APIClient = Container.shared.apiClient) {
        self.apiClient = apiClient
    }
}
