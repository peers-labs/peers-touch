import Foundation

@Observable
final class HomeViewModel {
    private let repository: HomeRepository

    var isLoading = false

    init(repository: HomeRepository = HomeRepository()) {
        self.repository = repository
    }
}
