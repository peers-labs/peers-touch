import Foundation

final class TimelineRepository: Sendable {
    private let apiClient: APIClient

    init(apiClient: APIClient = Container.shared.apiClient) {
        self.apiClient = apiClient
    }
}
