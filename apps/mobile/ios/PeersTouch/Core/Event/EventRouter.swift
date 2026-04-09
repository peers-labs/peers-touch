import Foundation

typealias EventHandler = @Sendable (StationEvent) -> Void

final class EventRouter: @unchecked Sendable {
    private var handlers: [String: [EventHandler]] = [:]
    private let lock = NSLock()

    func register(eventType: String, handler: @escaping EventHandler) {
        lock.withLock {
            handlers[eventType, default: []].append(handler)
        }
    }

    func dispatch(event: StationEvent) {
        let matchedHandlers: [EventHandler] = lock.withLock {
            handlers[event.type] ?? []
        }
        for handler in matchedHandlers {
            handler(event)
        }
    }

    func removeAll(for eventType: String) {
        lock.withLock {
            handlers.removeValue(forKey: eventType)
        }
    }
}
