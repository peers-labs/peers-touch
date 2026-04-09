import Foundation

final class ProfileRepository: Sendable {
    private let apiClient: APIClient

    init(apiClient: APIClient = Container.shared.apiClient) {
        self.apiClient = apiClient
    }
}
