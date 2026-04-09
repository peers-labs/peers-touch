import UIKit
import Lynx

final class LynxViewFactory: Sendable {
    private let engineManager: LynxEngineManager

    init(engineManager: LynxEngineManager) {
        self.engineManager = engineManager
    }

    func create(bundleURL: URL, bridgeSession: AppletBridgeSession) -> LynxView {
        guard engineManager.isInitialized else {
            fatalError("LynxEngineManager must be initialized before creating views")
        }
        let lynxView = LynxView(builderBlock: { builder in
            builder.frame = UIScreen.main.bounds
            builder.config = self.engineManager.config
        })
        lynxView.loadTemplate(fromURL: bundleURL.absoluteString)
        return lynxView
    }
}
