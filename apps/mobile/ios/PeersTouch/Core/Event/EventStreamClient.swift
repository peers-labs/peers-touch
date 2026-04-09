import Foundation

struct StationEvent: Sendable {
    let type: String
    let data: String
    let id: String?
}

final class EventStreamClient: @unchecked Sendable {
    private let session: URLSession
    private var currentTask: Task<Void, Never>?
    private var baseURL: URL?
    private var token: String?

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        self.session = URLSession(configuration: configuration)
    }

    func connect(baseURL: URL, token: String) -> AsyncStream<StationEvent> {
        self.baseURL = baseURL
        self.token = token

        let url = baseURL.appendingPathComponent("events/stream")

        return AsyncStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

                    let (bytes, _) = try await session.bytes(for: request)
                    var eventType: String?
                    var eventId: String?
                    var dataBuffer = ""

                    for try await line in bytes.lines {
                        if line.hasPrefix("event:") {
                            eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                            if !dataBuffer.isEmpty { dataBuffer.append("\n") }
                            dataBuffer.append(data)
                        } else if line.hasPrefix("id:") {
                            eventId = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                        } else if line.isEmpty, !dataBuffer.isEmpty {
                            let event = StationEvent(
                                type: eventType ?? "message",
                                data: dataBuffer,
                                id: eventId
                            )
                            continuation.yield(event)
                            eventType = nil
                            eventId = nil
                            dataBuffer = ""
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish()
                }
            }

            self.currentTask = task

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    func disconnect() {
        currentTask?.cancel()
        currentTask = nil
        session.invalidateAndCancel()
    }
}
