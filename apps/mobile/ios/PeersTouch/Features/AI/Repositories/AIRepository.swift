import Foundation

final class AIRepository: Sendable {
    private let apiClient: APIClient

    init(apiClient: APIClient = Container.shared.apiClient) {
        self.apiClient = apiClient
    }
}
