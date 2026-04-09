import Foundation

enum AppletState: String, Sendable {
    case registered
    case loading
    case ready
    case running
    case suspended
    case error
    case unloaded
}
