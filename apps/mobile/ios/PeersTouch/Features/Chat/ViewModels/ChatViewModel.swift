import Foundation

@Observable
final class ChatViewModel {
    private let repository: ChatRepository

    var isLoading = false

    init(repository: ChatRepository = ChatRepository()) {
        self.repository = repository
    }
}
