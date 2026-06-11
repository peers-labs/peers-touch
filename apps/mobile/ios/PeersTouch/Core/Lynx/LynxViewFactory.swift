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
        let config = LynxConfig(provider: engineManager.config?.templateProvider)
        config.register(AppletBridgeNativeModule.self, param: bridgeSession)
        LynxEnv.sharedInstance().prepareConfig(config)

        let lynxView = LynxView(builderBlock: { builder in
            builder.frame = UIScreen.main.bounds
            builder.config = config
        })
        if let bundleData = try? Data(contentsOf: bundleURL) {
            lynxView.loadTemplate(bundleData, withURL: bundleURL.absoluteString)
        } else {
            lynxView.loadTemplate(fromURL: bundleURL.absoluteString)
        }
        return lynxView
    }
}
