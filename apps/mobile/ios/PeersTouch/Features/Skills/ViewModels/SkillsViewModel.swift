import Foundation

@Observable
final class SkillsViewModel {
    private let repository: SkillsRepository

    var isLoading = false

    init(repository: SkillsRepository = SkillsRepository()) {
        self.repository = repository
    }
}
