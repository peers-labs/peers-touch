import Foundation

@Observable
final class AuthViewModel {
    private let repository: AuthRepository

    var isLoading = false

    init(repository: AuthRepository = AuthRepository()) {
        self.repository = repository
    }
}
