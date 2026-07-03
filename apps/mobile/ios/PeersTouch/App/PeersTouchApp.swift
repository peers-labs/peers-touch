import SwiftUI

@main
struct PeersTouchApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var router = Router()

    init() {
        LynxEngineManager.shared.initialize()
    }

    var body: some Scene {
        WindowGroup {
            if let e2eAppletId = ProcessInfo.processInfo.environment["PEERS_APPLET_IOS_RUNTIME_E2E_APPLET_ID"],
               !e2eAppletId.isEmpty {
                AppletContainerView(appletId: e2eAppletId)
            } else {
                AppTabView()
                    .environment(router)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                Container.shared.appletManager.pauseActiveInstances()
            case .active:
                Container.shared.appletManager.resumePausedInstances()
            default:
                break
            }
        }
    }
}
