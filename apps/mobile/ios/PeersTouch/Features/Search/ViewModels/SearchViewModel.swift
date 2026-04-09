import Foundation

@Observable
final class SearchViewModel {
    private let repository: SearchRepository

    var isLoading = false

    init(repository: SearchRepository = SearchRepository()) {
        self.repository = repository
    }
}
