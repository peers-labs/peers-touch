import Foundation

@Observable
final class ProfileViewModel {
    private let repository: ProfileRepository

    var isLoading = false

    init(repository: ProfileRepository = ProfileRepository()) {
        self.repository = repository
    }
}
