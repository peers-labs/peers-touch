import Foundation

@Observable
final class SettingsViewModel {
    private let repository: SettingsRepository

    var isLoading = false

    init(repository: SettingsRepository = SettingsRepository()) {
        self.repository = repository
    }
}
