import SwiftUI

@main
struct PeersTouchApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var router = Router()

    init() {
        LynxEngineManager.shared.initialize()
    }

    var body: some Scene {
        WindowGroup {
            AppTabView()
                .environment(router)
        }
    }
}
