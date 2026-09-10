import AVFoundation
import Foundation
import Photos
import SwiftRs
import Tauri
import UIKit
import UserNotifications
import WebKit

private let lifecycleEvent = "lifecycle"

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

final class PlatformPermissionsPlugin: Plugin {
  private var lifecycleObservers: [NSObjectProtocol] = []
  private var lifecycleSequence = 0
  private var backgrounded = false
  private var permissionRequestInProgress = false

  override func load(webview: WKWebView) {
    super.load(webview: webview)
    installLifecycleObservers()
    backgrounded = UIApplication.shared.applicationState == .background
  }

  deinit {
    for observer in lifecycleObservers {
      NotificationCenter.default.removeObserver(observer)
    }
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
      DispatchQueue.main.async {
        guard !self.permissionRequestInProgress else {
          invoke.reject(
            "another platform permission request is already active",
            code: "PLATFORM_PERMISSION_REQUEST_IN_PROGRESS"
          )
          return
        }

        self.permissionRequestInProgress = true
        self.checkPermission(kind) { current in
          guard current.status == .notDetermined && current.canRequest else {
            self.permissionRequestInProgress = false
            self.resolve(invoke, current)
            return
          }

          self.requestPermission(kind) { result in
            self.permissionRequestInProgress = false
            self.resolve(invoke, result)
          }
        }
      }
    } catch {
      reject(invoke, operation: "request", error: error)
    }
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
      return PermissionResponse(status: .restricted, canRequest: true)
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
      return PermissionResponse(status: .restricted, canRequest: true)
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

private enum PlatformPermissionFailure: Error {
  case invalidKind
}

@_cdecl("init_plugin_platform_permissions")
func initPlugin() -> Plugin {
  return PlatformPermissionsPlugin()
}
