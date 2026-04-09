import Foundation

@Observable
final class MemoryViewModel {
    private let repository: MemoryRepository

    var isLoading = false

    init(repository: MemoryRepository = MemoryRepository()) {
        self.repository = repository
    }
}
