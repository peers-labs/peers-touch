import Foundation

final class AppletsRepository: Sendable {
    private let apiClient: APIClient
    private let appletManager: AppletManager

    init(
        apiClient: APIClient = Container.shared.apiClient,
        appletManager: AppletManager = Container.shared.appletManager
    ) {
        self.apiClient = apiClient
        self.appletManager = appletManager
    }
}
