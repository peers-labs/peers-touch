import Foundation

@Observable
final class TimelineViewModel {
    private let repository: TimelineRepository

    var isLoading = false

    init(repository: TimelineRepository = TimelineRepository()) {
        self.repository = repository
    }
}
