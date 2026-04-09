import Foundation

@Observable
final class ChannelsViewModel {
    private let repository: ChannelsRepository

    var isLoading = false

    init(repository: ChannelsRepository = ChannelsRepository()) {
        self.repository = repository
    }
}
