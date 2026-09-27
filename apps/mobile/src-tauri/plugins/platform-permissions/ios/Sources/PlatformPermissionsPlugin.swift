import AVFoundation
import BackgroundTasks
import CryptoKit
import Foundation
import Network
import ObjectiveC.runtime
import Photos
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

private let lifecycleEvent = "lifecycle"
private let networkEvent = "network"
private let pushAvailableEvent = "pushAvailable"
private let scheduledAvailableEvent = "scheduledAvailable"
private let scheduledDevelopmentIdentifier =
  "com.peers.touch.mobile.reconcile.v1.development"
private let scheduledProductionIdentifier =
  "com.peers.touch.mobile.reconcile.v1.production"
private let didRegisterRemoteNotificationsSelector = NSSelectorFromString(
  "application:didRegisterForRemoteNotificationsWithDeviceToken:"
)
private weak var activePushPlugin: PlatformPermissionsPlugin?
private var originalDidRegisterRemoteNotificationsImplementation: IMP?
private var remoteNotificationHookInstalled = false

private struct PermissionArgs: Decodable {
  let kind: String
}

private struct PermissionResponse: Encodable {
  let status: PermissionStatus
  let canRequest: Bool
}

private struct LifecycleSignal: Encodable {
  let platform: String
  let state: LifecycleState
  let sequence: Int
  let timestampMs: Int
}

private struct NetworkSignal: Encodable {
  let platform: String
  let connected: Bool
  let networkType: NetworkType
  let sequence: Int
  let timestampMs: Int
}

private struct PushArmArgs: Decodable {
  let lifecycleGeneration: Int
  let environment: String
}

private struct PushArmResponse: Encodable {
  let armed: Bool
}

private struct PushAvailableSignal: Encodable {
  let lifecycleGeneration: Int
  let pendingCount: Int
}

private struct NativePushCallback: Encodable {
  let kind: String
  let platform: String
  let sequence: Int
  let lifecycleGeneration: Int
  let environment: String?
  let apnsTokenBase64: String?
  let apnsTopic: String?
  let fcmToken: String?
  let unifiedEndpoint: String?
  let unifiedP256dhBase64: String?
  let unifiedAuthBase64: String?
  let notificationId: String?
  let category: Int?
  let targetHint: String?
  let issuedAtMs: Int?
  let expiresAtMs: Int?
}

private struct NativePushCallbackBatch: Encodable {
  let callbacks: [NativePushCallback]
}

private struct ScheduledReconcileRegistration: Encodable {
  let identifier: String
  let registered: Bool
}

private struct ScheduledCompletionArgs: Decodable {
  let completionId: String
  let success: Bool
}

private struct NativeScheduledCallback: Encodable {
  let completionId: String
  let identifier: String
  let platform: String
  let sequence: Int
  let lifecycleGeneration: Int
  let deadlineMs: Int
}

private struct NativeScheduledCallbackBatch: Encodable {
  let callbacks: [NativeScheduledCallback]
}

private struct MediaPickArgs: Decodable {
  let requestId: String
  let surfaceKind: String
  let capability: String
  let lifecycleGeneration: Int
  let deadlineMs: Int
  let acceptedMediaKinds: [String]
  let maxItemCount: Int
  let maxTotalBytes: Int
}

private struct NativeMediaPickItem: Encodable {
  let localPath: String
  let mediaKind: String
  let mimeType: String
  let byteLength: Int
  let sha256Base64: String
}

private struct NativeMediaPickResponse: Encodable {
  let requestId: String
  let lifecycleGeneration: Int
  let outcome: String
  let items: [NativeMediaPickItem]
  let errorCode: String?
}

private enum PermissionKind: String {
  case camera
  case microphone
  case storage
  case notifications
}

private enum PermissionStatus: String, Encodable {
  case notDetermined = "not_determined"
  case granted
  case denied
  case restricted
  case unsupported
}

private enum LifecycleState: String, Encodable {
  case foreground
  case background
}

private enum NetworkType: String, Encodable {
  case none
  case wifi
  case cellular
  case ethernet
  case unknown
}

final class PlatformPermissionsPlugin: Plugin, UNUserNotificationCenterDelegate,
  UIDocumentPickerDelegate, UIImagePickerControllerDelegate,
  UINavigationControllerDelegate
{
  private var lifecycleObservers: [NSObjectProtocol] = []
  private var lifecycleSequence = 0
  private let networkMonitor = NWPathMonitor()
  private let networkMonitorQueue = DispatchQueue(
    label: "com.peers.touch.mobile.network-monitor"
  )
  private var networkObservationStarted = false
  private var networkObservationReady = false
  private var pendingNetworkObservationInvokes: [Invoke] = []
  private var networkSequence = 0
  private var latestNetworkSignal: NetworkSignal?
  private var backgrounded = false
  private var permissionRequestInProgress = false
  private var pushLifecycleGeneration: Int?
  private var pushEnvironment: String?
  private var pushSequence = 0
  private var pendingPushCallbacks: [NativePushCallback] = []
  private var scheduledSequence = 0
  private var pendingScheduledCallbacks: [NativeScheduledCallback] = []
  private var pendingScheduledTasks: [String: BGTask] = [:]
  private var registeredScheduledIdentifiers: Set<String> = []
  private var activeMediaPick: (args: MediaPickArgs, invoke: Invoke)?
  private weak var activeMediaPickerController: UIViewController?

  override func load(webview: WKWebView) {
    super.load(webview: webview)
    installLifecycleObservers()
    backgrounded = UIApplication.shared.applicationState == .background
    UNUserNotificationCenter.current().delegate = self
    activePushPlugin = self
    installRemoteNotificationDelegateHook()
    registerScheduledHandlers()
    cleanupNativePickerCache()
  }

  deinit {
    for observer in lifecycleObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    networkMonitor.cancel()
  }

  @objc public func check(_ invoke: Invoke) {
    do {
      let kind = try parseKind(invoke)
      checkPermission(kind) { response in
        self.resolve(invoke, response)
      }
    } catch {
      reject(invoke, operation: "check", error: error)
    }
  }

  @objc public func request(_ invoke: Invoke) {
    do {
      let kind = try parseKind(invoke)
      DispatchQueue.main.async { [self] in
        guard !self.permissionRequestInProgress else {
          invoke.reject(
            "another platform permission request is already active",
            code: "PLATFORM_PERMISSION_REQUEST_IN_PROGRESS"
          )
          return
        }

        self.permissionRequestInProgress = true
        self.checkPermission(kind) { current in
          DispatchQueue.main.async {
            guard current.status == .notDetermined && current.canRequest else {
              self.permissionRequestInProgress = false
              self.resolve(invoke, current)
              return
            }

            self.requestPermission(kind) { result in
              DispatchQueue.main.async {
                self.permissionRequestInProgress = false
                self.resolve(invoke, result)
              }
            }
          }
        }
      }
    } catch {
      reject(invoke, operation: "request", error: error)
    }
  }

  @objc public func startNetworkObservation(_ invoke: Invoke) {
    DispatchQueue.main.async {
      if self.networkObservationReady, let signal = self.latestNetworkSignal {
        invoke.resolve(signal)
        return
      }
      self.pendingNetworkObservationInvokes.append(invoke)
      if !self.networkObservationStarted {
        self.networkObservationStarted = true
        self.networkMonitor.pathUpdateHandler = { [weak self] path in
          DispatchQueue.main.async {
            self?.emitNetworkSignal(path)
          }
        }
        self.networkMonitor.start(queue: self.networkMonitorQueue)
      }
    }
  }

  @objc public func armPush(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PushArmArgs.self)
      guard args.lifecycleGeneration > 0,
        args.environment == "development" || args.environment == "production"
      else {
        invoke.reject("invalid push arm request", code: "PLATFORM_PUSH_INVALID_ARM")
        return
      }
      DispatchQueue.main.async {
        self.pushLifecycleGeneration = args.lifecycleGeneration
        self.pushEnvironment = args.environment
        self.pendingPushCallbacks.removeAll()
        UIApplication.shared.registerForRemoteNotifications()
        invoke.resolve(PushArmResponse(armed: true))
      }
    } catch {
      invoke.reject("invalid push arm request", code: "PLATFORM_PUSH_INVALID_ARM")
    }
  }

  @objc public func drainPushCallbacks(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let callbacks = self.pendingPushCallbacks
      self.pendingPushCallbacks.removeAll()
      invoke.resolve(NativePushCallbackBatch(callbacks: callbacks))
    }
  }

  @objc public func disarmPush(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.pushLifecycleGeneration = nil
      self.pushEnvironment = nil
      self.pendingPushCallbacks.removeAll()
      for completionId in Array(self.pendingScheduledTasks.keys) {
        self.finishScheduledCallback(completionId, success: false)
      }
      self.pendingScheduledCallbacks.removeAll()
      BGTaskScheduler.shared.cancel(
        taskRequestWithIdentifier: scheduledDevelopmentIdentifier
      )
      BGTaskScheduler.shared.cancel(
        taskRequestWithIdentifier: scheduledProductionIdentifier
      )
      UIApplication.shared.unregisterForRemoteNotifications()
      invoke.resolve()
    }
  }

  @objc public func scheduleReconcile(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PushArmArgs.self)
      guard args.lifecycleGeneration > 0,
        let identifier = scheduledIdentifier(args.environment)
      else {
        invoke.reject(
          "invalid scheduled reconcile request",
          code: "PLATFORM_SCHEDULE_INVALID"
        )
        return
      }
      DispatchQueue.main.async {
        self.pushLifecycleGeneration = args.lifecycleGeneration
        self.pushEnvironment = args.environment
        for completionId in Array(self.pendingScheduledTasks.keys) {
          self.finishScheduledCallback(completionId, success: false)
        }
        self.pendingScheduledCallbacks.removeAll()
        let inactiveIdentifier =
          identifier == scheduledDevelopmentIdentifier
          ? scheduledProductionIdentifier
          : scheduledDevelopmentIdentifier
        BGTaskScheduler.shared.cancel(
          taskRequestWithIdentifier: inactiveIdentifier
        )
        do {
          try self.submitScheduledReconcile(identifier)
          invoke.resolve(
            ScheduledReconcileRegistration(
              identifier: identifier,
              registered: true
            )
          )
        } catch {
          invoke.reject(
            "scheduled reconcile registration failed",
            code: "PLATFORM_SCHEDULE_FAILED"
          )
        }
      }
    } catch {
      invoke.reject(
        "invalid scheduled reconcile request",
        code: "PLATFORM_SCHEDULE_INVALID"
      )
    }
  }

  @objc public func drainScheduledCallbacks(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let callbacks = self.pendingScheduledCallbacks
      self.pendingScheduledCallbacks.removeAll()
      invoke.resolve(NativeScheduledCallbackBatch(callbacks: callbacks))
    }
  }

  @objc public func completeScheduledCallback(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(ScheduledCompletionArgs.self)
      DispatchQueue.main.async {
        self.finishScheduledCallback(args.completionId, success: args.success)
        invoke.resolve()
      }
    } catch {
      invoke.reject(
        "invalid scheduled completion",
        code: "PLATFORM_SCHEDULE_INVALID_COMPLETION"
      )
    }
  }

  @objc public func pickMedia(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(MediaPickArgs.self)
      guard validMediaPickArgs(args) else {
        resolveMediaPick(
          invoke,
          args: args,
          outcome: "failed",
          items: [],
          errorCode: "invalid_request"
        )
        return
      }
      DispatchQueue.main.async { [self] in
        guard self.activeMediaPick == nil else {
          self.resolveMediaPick(
            invoke,
            args: args,
            outcome: "failed",
            items: [],
            errorCode: "picker_busy"
          )
          return
        }
        guard let presenter = self.manager.viewController else {
          self.resolveMediaPick(
            invoke,
            args: args,
            outcome: "failed",
            items: [],
            errorCode: "presenter_unavailable"
          )
          return
        }
        let picker: UIViewController
        if args.capability == "camera" {
          guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            self.resolveMediaPick(
              invoke,
              args: args,
              outcome: "permission_required",
              items: [],
              errorCode: "camera_permission_required"
            )
            return
          }
          guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            self.resolveMediaPick(
              invoke,
              args: args,
              outcome: "failed",
              items: [],
              errorCode: "camera_unavailable"
            )
            return
          }
          let camera = UIImagePickerController()
          camera.sourceType = .camera
          camera.delegate = self
          camera.mediaTypes = self.cameraMediaTypes(args.acceptedMediaKinds)
          picker = camera
        } else {
          let documents = UIDocumentPickerViewController(
            forOpeningContentTypes: self.documentTypes(args.acceptedMediaKinds),
            asCopy: true
          )
          documents.delegate = self
          documents.allowsMultipleSelection = args.maxItemCount > 1
          picker = documents
        }
        self.activeMediaPick = (args, invoke)
        self.activeMediaPickerController = picker
        presenter.present(picker, animated: true)

        let delay = max(
          0,
          Double(args.deadlineMs) / 1_000 - Date().timeIntervalSince1970
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
          guard let self = self,
            self.activeMediaPick?.args.requestId == args.requestId
          else {
            return
          }
          self.activeMediaPickerController?.dismiss(animated: true)
          self.finishMediaPick(
            outcome: "expired",
            items: [],
            errorCode: nil
          )
        }
      }
    } catch {
      invoke.reject("invalid media picker request", code: "PLATFORM_PICKER_INVALID")
    }
  }

  public func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    guard let active = activeMediaPick else {
      deleteNativePickerFiles(urls)
      return
    }
    do {
      let items = try copyPickedURLs(urls, args: active.args)
      finishMediaPick(outcome: "selected", items: items, errorCode: nil)
    } catch {
      deleteNativePickerFiles(urls)
      finishMediaPick(
        outcome: "failed",
        items: [],
        errorCode: "native_copy_failed"
      )
    }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finishMediaPick(outcome: "cancelled", items: [], errorCode: nil)
  }

  public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    finishMediaPick(outcome: "cancelled", items: [], errorCode: nil)
  }

  public func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    guard let active = activeMediaPick else {
      return
    }
    do {
      let source: URL
      if let mediaURL = info[.mediaURL] as? URL {
        source = mediaURL
      } else if let imageURL = info[.imageURL] as? URL {
        source = imageURL
      } else if let image = info[.originalImage] as? UIImage,
        let jpeg = image.jpegData(compressionQuality: 0.95)
      {
        let root = FileManager.default.temporaryDirectory
          .appendingPathComponent("peers-touch-native-picker", isDirectory: true)
          .appendingPathComponent(active.args.requestId, isDirectory: true)
        try FileManager.default.createDirectory(
          at: root,
          withIntermediateDirectories: true
        )
        source = root.appendingPathComponent("\(UUID().uuidString).jpg")
        try jpeg.write(to: source, options: .atomic)
      } else {
        throw NativePickerFailure.invalidSelection
      }
      let items = try copyPickedURLs([source], args: active.args)
      if source.path.contains("peers-touch-native-picker") {
        try? FileManager.default.removeItem(at: source)
      }
      finishMediaPick(outcome: "selected", items: items, errorCode: nil)
    } catch {
      finishMediaPick(
        outcome: "failed",
        items: [],
        errorCode: "native_copy_failed"
      )
    }
  }

  // The application delegate forwards the opaque APNs token here. The token
  // remains inside the native-plugin-to-Rust drain path and is never emitted
  // through a Web-visible plugin event.
  public func ingestAPNsDeviceToken(_ token: Data, topic: String) {
    guard !token.isEmpty, !topic.isEmpty else {
      return
    }
    enqueuePushCallback(
      kind: "token",
      environment: pushEnvironment,
      apnsTokenBase64: token.base64EncodedString(),
      apnsTopic: topic
    )
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    enqueuePushWakeup(notification.request.content.userInfo, kind: "receipt")
    completionHandler([])
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    enqueuePushWakeup(response.notification.request.content.userInfo, kind: "tap")
    completionHandler()
  }

  private func checkPermission(
    _ kind: PermissionKind,
    completion: @escaping (PermissionResponse) -> Void
  ) {
    switch kind {
    case .camera:
      completion(mapCaptureStatus(AVCaptureDevice.authorizationStatus(for: .video)))
    case .microphone:
      completion(mapCaptureStatus(AVCaptureDevice.authorizationStatus(for: .audio)))
    case .storage:
      if #available(iOS 14, *) {
        completion(mapPhotoStatus(PHPhotoLibrary.authorizationStatus(for: .readWrite)))
      } else {
        completion(mapPhotoStatus(PHPhotoLibrary.authorizationStatus()))
      }
    case .notifications:
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        completion(self.mapNotificationStatus(settings.authorizationStatus))
      }
    }
  }

  private func requestPermission(
    _ kind: PermissionKind,
    completion: @escaping (PermissionResponse) -> Void
  ) {
    switch kind {
    case .camera:
      AVCaptureDevice.requestAccess(for: .video) { _ in
        completion(self.mapCaptureStatus(AVCaptureDevice.authorizationStatus(for: .video)))
      }
    case .microphone:
      AVCaptureDevice.requestAccess(for: .audio) { _ in
        completion(self.mapCaptureStatus(AVCaptureDevice.authorizationStatus(for: .audio)))
      }
    case .storage:
      if #available(iOS 14, *) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
          completion(self.mapPhotoStatus(status))
        }
      } else {
        PHPhotoLibrary.requestAuthorization { status in
          completion(self.mapPhotoStatus(status))
        }
      }
    case .notifications:
      UNUserNotificationCenter.current().requestAuthorization(
        options: [.alert, .badge, .sound]
      ) { _, _ in
        self.checkPermission(.notifications, completion: completion)
      }
    }
  }

  private func mapCaptureStatus(_ status: AVAuthorizationStatus) -> PermissionResponse {
    switch status {
    case .notDetermined:
      return PermissionResponse(status: .notDetermined, canRequest: true)
    case .authorized:
      return PermissionResponse(status: .granted, canRequest: false)
    case .denied:
      return PermissionResponse(status: .denied, canRequest: false)
    case .restricted:
      return PermissionResponse(status: .restricted, canRequest: false)
    @unknown default:
      return PermissionResponse(status: .restricted, canRequest: false)
    }
  }

  private func mapPhotoStatus(_ status: PHAuthorizationStatus) -> PermissionResponse {
    if #available(iOS 14, *), status == .limited {
      return PermissionResponse(status: .granted, canRequest: false)
    }

    switch status {
    case .notDetermined:
      return PermissionResponse(status: .notDetermined, canRequest: true)
    case .authorized:
      return PermissionResponse(status: .granted, canRequest: false)
    case .denied:
      return PermissionResponse(status: .denied, canRequest: false)
    case .restricted:
      return PermissionResponse(status: .restricted, canRequest: false)
    case .limited:
      return PermissionResponse(status: .granted, canRequest: false)
    @unknown default:
      return PermissionResponse(status: .restricted, canRequest: false)
    }
  }

  private func mapNotificationStatus(_ status: UNAuthorizationStatus) -> PermissionResponse {
    if #available(iOS 14, *), status == .ephemeral {
      return PermissionResponse(status: .granted, canRequest: false)
    }

    switch status {
    case .notDetermined:
      return PermissionResponse(status: .notDetermined, canRequest: true)
    case .authorized, .provisional:
      return PermissionResponse(status: .granted, canRequest: false)
    case .denied:
      return PermissionResponse(status: .denied, canRequest: false)
    case .ephemeral:
      return PermissionResponse(status: .granted, canRequest: false)
    @unknown default:
      return PermissionResponse(status: .restricted, canRequest: false)
    }
  }

  private func installLifecycleObservers() {
    guard lifecycleObservers.isEmpty else {
      return
    }

    let center = NotificationCenter.default
    lifecycleObservers.append(
      center.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self = self, !self.backgrounded else {
          return
        }
        self.backgrounded = true
        self.emitLifecycleSignal(.background)
      }
    )
    lifecycleObservers.append(
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self = self, self.backgrounded else {
          return
        }
        self.backgrounded = false
        self.emitLifecycleSignal(.foreground)
      }
    )
  }

  private func emitLifecycleSignal(_ state: LifecycleState) {
    lifecycleSequence += 1
    let signal = LifecycleSignal(
      platform: "ios",
      state: state,
      sequence: lifecycleSequence,
      timestampMs: Int(Date().timeIntervalSince1970 * 1_000)
    )
    do {
      try trigger(lifecycleEvent, data: signal)
    } catch {
      Logger.error("platform-permissions lifecycle signal failed")
    }
  }

  private func emitNetworkSignal(_ path: NWPath) {
    networkSequence += 1
    let connected = path.status == .satisfied
    let signal = NetworkSignal(
      platform: "ios",
      connected: connected,
      networkType: networkType(path, connected: connected),
      sequence: networkSequence,
      timestampMs: Int(Date().timeIntervalSince1970 * 1_000)
    )
    do {
      try trigger(networkEvent, data: signal)
      latestNetworkSignal = signal
      networkObservationReady = true
      let pending = pendingNetworkObservationInvokes
      pendingNetworkObservationInvokes.removeAll()
      for invoke in pending {
        invoke.resolve(signal)
      }
    } catch {
      Logger.error("platform-permissions network signal failed")
      let pending = pendingNetworkObservationInvokes
      pendingNetworkObservationInvokes.removeAll()
      for invoke in pending {
        invoke.reject(
          "initial native network signal failed",
          code: "PLATFORM_NETWORK_OBSERVATION_FAILED"
        )
      }
    }
  }

  private func enqueuePushWakeup(_ userInfo: [AnyHashable: Any], kind: String) {
    guard
      let notificationId = userInfo["notification_id"] as? String,
      let category = integer(userInfo["category"]),
      let targetHint = userInfo["target_hint"] as? String,
      let issuedAtMs = integer(userInfo["issued_at_ms"]),
      let expiresAtMs = integer(userInfo["expires_at_ms"])
    else {
      return
    }
    enqueuePushCallback(
      kind: kind,
      notificationId: notificationId,
      category: category,
      targetHint: targetHint,
      issuedAtMs: issuedAtMs,
      expiresAtMs: expiresAtMs
    )
  }

  private func registerScheduledHandlers() {
    for identifier in [
      scheduledDevelopmentIdentifier,
      scheduledProductionIdentifier,
    ] where !registeredScheduledIdentifiers.contains(identifier) {
      let registered = BGTaskScheduler.shared.register(
        forTaskWithIdentifier: identifier,
        using: nil
      ) { [weak self] task in
        self?.handleScheduledTask(task, identifier: identifier)
      }
      if registered {
        registeredScheduledIdentifiers.insert(identifier)
      }
    }
  }

  private func submitScheduledReconcile(_ identifier: String) throws {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    try BGTaskScheduler.shared.submit(request)
  }

  private func handleScheduledTask(_ task: BGTask, identifier: String) {
    guard let generation = pushLifecycleGeneration,
      let environment = pushEnvironment,
      scheduledIdentifier(environment) == identifier
    else {
      task.setTaskCompleted(success: true)
      return
    }
    scheduledSequence += 1
    let completionId = "\(identifier):\(scheduledSequence)"
    let callback = NativeScheduledCallback(
      completionId: completionId,
      identifier: identifier,
      platform: "ios",
      sequence: scheduledSequence,
      lifecycleGeneration: generation,
      deadlineMs: Int(Date().timeIntervalSince1970 * 1_000) + 25_000
    )
    pendingScheduledTasks[completionId] = task
    pendingScheduledCallbacks.append(callback)
    task.expirationHandler = { [weak self] in
      DispatchQueue.main.async {
        self?.finishScheduledCallback(completionId, success: false)
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
      self?.finishScheduledCallback(completionId, success: false)
    }
    if let environment = pushEnvironment,
      let nextIdentifier = scheduledIdentifier(environment)
    {
      try? submitScheduledReconcile(nextIdentifier)
    }
    do {
      try trigger(
        scheduledAvailableEvent,
        data: PushAvailableSignal(
          lifecycleGeneration: generation,
          pendingCount: pendingScheduledCallbacks.count
        )
      )
    } catch {
      finishScheduledCallback(completionId, success: false)
    }
  }

  private func finishScheduledCallback(_ completionId: String, success: Bool) {
    guard let task = pendingScheduledTasks.removeValue(forKey: completionId) else {
      return
    }
    pendingScheduledCallbacks.removeAll { $0.completionId == completionId }
    task.expirationHandler = nil
    task.setTaskCompleted(success: success)
  }

  private func scheduledIdentifier(_ environment: String) -> String? {
    switch environment {
    case "development":
      return scheduledDevelopmentIdentifier
    case "production":
      return scheduledProductionIdentifier
    default:
      return nil
    }
  }

  private func validMediaPickArgs(_ args: MediaPickArgs) -> Bool {
    let nowMs = Int(Date().timeIntervalSince1970 * 1_000)
    return !args.requestId.isEmpty
      && (args.surfaceKind == "chat_attachment" || args.surfaceKind == "moment_media")
      && (
        args.capability == "photo_library"
          || args.capability == "camera"
          || args.capability == "document"
      )
      && args.lifecycleGeneration > 0
      && args.deadlineMs > nowMs
      && args.deadlineMs <= nowMs + 5 * 60 * 1_000
      && args.maxItemCount >= 1
      && args.maxItemCount <= 10
      && args.maxTotalBytes >= 1
      && args.maxTotalBytes <= 64 * 1024 * 1024
      && !args.acceptedMediaKinds.isEmpty
      && args.acceptedMediaKinds.allSatisfy {
        $0 == "image" || $0 == "video" || $0 == "file"
      }
  }

  private func documentTypes(_ mediaKinds: [String]) -> [UTType] {
    var types: [UTType] = []
    if mediaKinds.contains("image") {
      types.append(.image)
    }
    if mediaKinds.contains("video") {
      types.append(.movie)
    }
    if mediaKinds.contains("file") {
      types.append(.data)
    }
    return types
  }

  private func cameraMediaTypes(_ mediaKinds: [String]) -> [String] {
    var types: [String] = []
    if mediaKinds.contains("image") {
      types.append(UTType.image.identifier)
    }
    if mediaKinds.contains("video") {
      types.append(UTType.movie.identifier)
    }
    return types.isEmpty ? [UTType.image.identifier] : types
  }

  private func copyPickedURLs(
    _ urls: [URL],
    args: MediaPickArgs
  ) throws -> [NativeMediaPickItem] {
    guard !urls.isEmpty, urls.count <= args.maxItemCount else {
      throw NativePickerFailure.invalidSelection
    }
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("peers-touch-native-picker", isDirectory: true)
      .appendingPathComponent(args.requestId, isDirectory: true)
    try FileManager.default.createDirectory(
      at: root,
      withIntermediateDirectories: true
    )
    var created: [URL] = []
    var result: [NativeMediaPickItem] = []
    var totalBytes = 0
    do {
      for url in urls {
        let accessing = url.startAccessingSecurityScopedResource()
        defer {
          if accessing {
            url.stopAccessingSecurityScopedResource()
          }
        }
        let destination = root.appendingPathComponent(
          "\(UUID().uuidString).stage"
        )
        try FileManager.default.copyItem(at: url, to: destination)
        created.append(destination)
        let attributes = try FileManager.default.attributesOfItem(
          atPath: destination.path
        )
        guard let size = attributes[.size] as? NSNumber, size.intValue > 0 else {
          throw NativePickerFailure.invalidSelection
        }
        totalBytes += size.intValue
        guard totalBytes <= args.maxTotalBytes else {
          throw NativePickerFailure.invalidSelection
        }
        let mediaKind = mediaKindForPath(destination.path)
        guard args.acceptedMediaKinds.contains(mediaKind) else {
          throw NativePickerFailure.invalidSelection
        }
        result.append(
          NativeMediaPickItem(
            localPath: destination.path,
            mediaKind: mediaKind,
            mimeType: mimeTypeForPath(destination.path, mediaKind: mediaKind),
            byteLength: size.intValue,
            sha256Base64: try sha256Base64(destination)
          )
        )
      }
      return result
    } catch {
      deleteNativePickerFiles(created)
      throw error
    }
  }

  private func finishMediaPick(
    outcome: String,
    items: [NativeMediaPickItem],
    errorCode: String?
  ) {
    guard let active = activeMediaPick else {
      deleteNativePickerFiles(items.map { URL(fileURLWithPath: $0.localPath) })
      return
    }
    activeMediaPick = nil
    activeMediaPickerController = nil
    resolveMediaPick(
      active.invoke,
      args: active.args,
      outcome: outcome,
      items: items,
      errorCode: errorCode
    )
  }

  private func resolveMediaPick(
    _ invoke: Invoke,
    args: MediaPickArgs,
    outcome: String,
    items: [NativeMediaPickItem],
    errorCode: String?
  ) {
    invoke.resolve(
      NativeMediaPickResponse(
        requestId: args.requestId,
        lifecycleGeneration: args.lifecycleGeneration,
        outcome: outcome,
        items: items,
        errorCode: errorCode
      )
    )
  }

  private func sha256Base64(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
      let data = handle.readData(ofLength: 64 * 1024)
      if data.isEmpty {
        break
      }
      hasher.update(data: data)
    }
    return Data(hasher.finalize()).base64EncodedString()
  }

  private func mediaKindForPath(_ path: String) -> String {
    switch URL(fileURLWithPath: path).pathExtension.lowercased() {
    case "jpg", "jpeg", "png", "gif", "heic", "webp":
      return "image"
    case "mov", "mp4", "m4v", "webm":
      return "video"
    default:
      return "file"
    }
  }

  private func mimeTypeForPath(_ path: String, mediaKind: String) -> String {
    switch URL(fileURLWithPath: path).pathExtension.lowercased() {
    case "jpg", "jpeg": return "image/jpeg"
    case "png": return "image/png"
    case "gif": return "image/gif"
    case "heic": return "image/heic"
    case "webp": return "image/webp"
    case "mov": return "video/quicktime"
    case "mp4", "m4v": return "video/mp4"
    case "webm": return "video/webm"
    default:
      return mediaKind == "file" ? "application/octet-stream" : "\(mediaKind)/*"
    }
  }

  private func deleteNativePickerFiles(_ urls: [URL]) {
    for url in urls where url.path.contains("peers-touch-native-picker") {
      try? FileManager.default.removeItem(at: url)
    }
  }

  private func cleanupNativePickerCache() {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("peers-touch-native-picker", isDirectory: true)
    try? FileManager.default.removeItem(at: root)
  }

  private func enqueuePushCallback(
    kind: String,
    environment: String? = nil,
    apnsTokenBase64: String? = nil,
    apnsTopic: String? = nil,
    notificationId: String? = nil,
    category: Int? = nil,
    targetHint: String? = nil,
    issuedAtMs: Int? = nil,
    expiresAtMs: Int? = nil
  ) {
    DispatchQueue.main.async {
      guard let generation = self.pushLifecycleGeneration else {
        return
      }
      self.pushSequence += 1
      self.pendingPushCallbacks.append(
        NativePushCallback(
          kind: kind,
          platform: "ios",
          sequence: self.pushSequence,
          lifecycleGeneration: generation,
          environment: environment,
          apnsTokenBase64: apnsTokenBase64,
          apnsTopic: apnsTopic,
          fcmToken: nil,
          unifiedEndpoint: nil,
          unifiedP256dhBase64: nil,
          unifiedAuthBase64: nil,
          notificationId: notificationId,
          category: category,
          targetHint: targetHint,
          issuedAtMs: issuedAtMs,
          expiresAtMs: expiresAtMs
        )
      )
      do {
        try self.trigger(
          pushAvailableEvent,
          data: PushAvailableSignal(
            lifecycleGeneration: generation,
            pendingCount: self.pendingPushCallbacks.count
          )
        )
      } catch {
        Logger.error("platform-permissions push availability signal failed")
      }
    }
  }

  private func integer(_ value: Any?) -> Int? {
    if let number = value as? NSNumber {
      return number.intValue
    }
    if let string = value as? String {
      return Int(string)
    }
    return nil
  }

  private func networkType(_ path: NWPath, connected: Bool) -> NetworkType {
    guard connected else {
      return .none
    }
    if path.usesInterfaceType(.wifi) {
      return .wifi
    }
    if path.usesInterfaceType(.cellular) {
      return .cellular
    }
    if path.usesInterfaceType(.wiredEthernet) {
      return .ethernet
    }
    return .unknown
  }

  private func parseKind(_ invoke: Invoke) throws -> PermissionKind {
    let arguments = try invoke.parseArgs(PermissionArgs.self)
    guard let kind = PermissionKind(rawValue: arguments.kind) else {
      throw PlatformPermissionFailure.invalidKind
    }
    return kind
  }

  private func resolve(_ invoke: Invoke, _ response: PermissionResponse) {
    DispatchQueue.main.async {
      invoke.resolve(response)
    }
  }

  private func reject(_ invoke: Invoke, operation: String, error: Error) {
    let code: String
    if case PlatformPermissionFailure.invalidKind = error {
      code = "PLATFORM_PERMISSION_INVALID_KIND"
    } else {
      code = "PLATFORM_PERMISSION_FAILED"
    }
    invoke.reject("\(operation) failed", code: code)
  }
}

private func installRemoteNotificationDelegateHook() {
  guard !remoteNotificationHookInstalled,
    let delegate = UIApplication.shared.delegate,
    let delegateClass: AnyClass = object_getClass(delegate)
  else {
    return
  }

  typealias RegistrationBlock = @convention(block) (
    AnyObject,
    UIApplication,
    NSData
  ) -> Void
  let block: RegistrationBlock = { delegateObject, application, token in
    activePushPlugin?.ingestAPNsDeviceToken(
      token as Data,
      topic: Bundle.main.bundleIdentifier ?? ""
    )
    if let original = originalDidRegisterRemoteNotificationsImplementation {
      typealias RegistrationImplementation = @convention(c) (
        AnyObject,
        Selector,
        UIApplication,
        NSData
      ) -> Void
      unsafeBitCast(original, to: RegistrationImplementation.self)(
        delegateObject,
        didRegisterRemoteNotificationsSelector,
        application,
        token
      )
    }
  }
  let replacement = imp_implementationWithBlock(block)
  if let method = class_getInstanceMethod(
    delegateClass,
    didRegisterRemoteNotificationsSelector
  ) {
    originalDidRegisterRemoteNotificationsImplementation = method_getImplementation(method)
    method_setImplementation(method, replacement)
  } else {
    class_addMethod(
      delegateClass,
      didRegisterRemoteNotificationsSelector,
      replacement,
      "v@:@@"
    )
  }
  remoteNotificationHookInstalled = true
}

private enum PlatformPermissionFailure: Error {
  case invalidKind
}

private enum NativePickerFailure: Error {
  case invalidSelection
}

@_cdecl("init_plugin_platform_permissions")
func initPlugin() -> Plugin {
  return PlatformPermissionsPlugin()
}
