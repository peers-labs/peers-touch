import Foundation

@Observable
final class AIViewModel {
    private let repository: AIRepository

    var isLoading = false

    init(repository: AIRepository = AIRepository()) {
        self.repository = repository
    }
}
