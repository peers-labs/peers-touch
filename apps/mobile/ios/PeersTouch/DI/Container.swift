import Foundation

final class Container: @unchecked Sendable {
    static let shared = Container()

    let apiClient: APIClient
    let appDatabase: AppDatabase
    let preferenceStore: PreferenceStore
    let eventStreamClient: EventStreamClient

    let lynxEngineManager: LynxEngineManager
    let lynxViewFactory: LynxViewFactory
    let bridgeDispatcher: BridgeDispatcher
    let appletManager: AppletManager
    let appletBundleStorage: AppletBundleStorage

    private init() {
        let preferenceStore = PreferenceStore()
        let apiClient = APIClient(
            baseURL: preferenceStore.stationBaseURL,
            authInterceptor: AuthInterceptor(preferenceStore: preferenceStore)
        )
        let appDatabase = AppDatabase()
        let eventStreamClient = EventStreamClient()
        let appletBundleStorage = AppletBundleStorage()
        let lynxEngineManager = LynxEngineManager.shared

        let lynxViewFactory = LynxViewFactory(engineManager: lynxEngineManager)

        let bridgeDispatcher = BridgeDispatcher(modules: [
            SystemBridgeModule(),
            StorageBridgeModule(),
            NetworkBridgeModule(),
            NotificationBridgeModule(),
            DeviceBridgeModule(),
            UIBridgeModule()
        ])

        let appletManager = AppletManager(
            bundleStorage: appletBundleStorage,
            bridgeDispatcher: bridgeDispatcher
        )

        self.apiClient = apiClient
        self.appDatabase = appDatabase
        self.preferenceStore = preferenceStore
        self.eventStreamClient = eventStreamClient
        self.lynxEngineManager = lynxEngineManager
        self.lynxViewFactory = lynxViewFactory
        self.bridgeDispatcher = bridgeDispatcher
        self.appletManager = appletManager
        self.appletBundleStorage = appletBundleStorage
    }
}
