import Foundation

final class AuthRepository: Sendable {
    private let apiClient: APIClient
    private let preferenceStore: PreferenceStore

    init(
        apiClient: APIClient = Container.shared.apiClient,
        preferenceStore: PreferenceStore = Container.shared.preferenceStore
    ) {
        self.apiClient = apiClient
        self.preferenceStore = preferenceStore
    }
}
