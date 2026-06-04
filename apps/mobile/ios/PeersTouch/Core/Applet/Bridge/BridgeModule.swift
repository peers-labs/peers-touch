import Foundation

protocol BridgeModule {
    var moduleName: String { get }
    func handle(method: String, params: [String: Any]) async throws -> Any?
}
