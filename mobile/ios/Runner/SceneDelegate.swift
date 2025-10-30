import UIKit
import Flutter

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var flutterEngine: FlutterEngine?
    private var methodChannel: FlutterMethodChannel?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }
        
        // Create and configure the Flutter engine
        flutterEngine = FlutterEngine(name: "io.flutter", project: nil)
        flutterEngine?.run()
        GeneratedPluginRegistrant.register(with: flutterEngine!)
        
        // Create the method channel for storage operations
        methodChannel = FlutterMethodChannel(name: "samples.flutter.dev/storage", binaryMessenger: flutterEngine!.binaryMessenger)
        methodChannel?.setMethodCallHandler { [weak self] (call, result) in
            guard let self = self else { return }
            
            if call.method == "getFreeDiskSpace" {
                result(self.getFreeDiskSpace())
            } else {
                result(FlutterMethodNotImplemented)
            }
        }
        
        // Create and configure the Flutter view controller
        let flutterViewController = FlutterViewController(engine: flutterEngine!, nibName: nil, bundle: nil)
        
        // Create and configure the window
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = flutterViewController
        window?.makeKeyAndVisible()
    }
    
    func sceneDidDisconnect(_ scene: UIScene) {
        // Called when the scene is being released by the system
        // This occurs shortly after the scene enters the background, or when its session is discarded
    }
    
    func sceneDidBecomeActive(_ scene: UIScene) {
        // Called when the scene has moved from an inactive state to an active state
        // Use this method to restart any tasks that were paused (or not yet started) when the scene was inactive
    }
    
    func sceneWillResignActive(_ scene: UIScene) {
        // Called when the scene will move from an active state to an inactive state
        // This may occur due to temporary interruptions (ex. an incoming phone call)
    }
    
    func sceneWillEnterForeground(_ scene: UIScene) {
        // Called as the scene transitions from the background to the foreground
        // Use this method to undo the changes made on entering the background
    }
    
    func sceneDidEnterBackground(_ scene: UIScene) {
        // Called as the scene transitions from the foreground to the background
        // Use this method to save data, release shared resources, and store enough scene-specific state information
        // to restore the scene back to its current state
    }
    
    // Function to get free disk space
    private func getFreeDiskSpace() -> Int64 {
        do {
            let systemAttributes = try FileManager.default.attributesOfFileSystem(forPath: NSHomeDirectory())
            let freeSpace = (systemAttributes[FileAttributeKey.systemFreeSize] as? NSNumber)?.int64Value
            return freeSpace ?? 0
        } catch {
            print("Error getting disk space: \(error)")
            return 0
        }
    }
}