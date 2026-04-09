import Foundation

@Observable
final class AppletsViewModel {
    private let repository: AppletsRepository

    var isLoading = false

    init(repository: AppletsRepository = AppletsRepository()) {
        self.repository = repository
    }
}
