import UIKit
import Lynx

final class LynxEngineManager: @unchecked Sendable {
    static let shared = LynxEngineManager()

    private(set) var isInitialized = false
    private let lock = NSLock()
    private(set) var config: LynxConfig?

    private init() {}

    func initialize() {
        lock.withLock {
            guard !isInitialized else { return }
            let lynxConfig = LynxConfig(provider: nil)
            LynxEnv.sharedInstance().prepareConfig(lynxConfig)
            config = lynxConfig
            isInitialized = true
        }
    }

    func shutdown() {
        lock.withLock {
            guard isInitialized else { return }
            config = nil
            isInitialized = false
        }
    }
}
