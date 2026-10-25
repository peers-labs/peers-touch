import Foundation
import QuickLook
import Tauri
import UIKit

struct NativeFileActionArgs: Decodable {
  let requestId: String
  let kind: String
  let localPath: String
  let mimeType: String
  let deadlineMs: UInt64
}

struct NativeFileActionCancellationArgs: Decodable {
  let requestId: String
}

private struct NativeFileActionResponse: Encodable {
  let requestId: String
  let state: String
  let reason: String?
}

/// OS presentation only. Rust supplies a verified disposable copy; this
/// coordinator never sees Chat identity, encryption material or cache handles.
final class NativeFileActions: NSObject, QLPreviewControllerDataSource,
  QLPreviewControllerDelegate, UIDocumentPickerDelegate,
  UIDocumentInteractionControllerDelegate, UIAdaptivePresentationControllerDelegate
{
  private var active: (args: NativeFileActionArgs, invoke: Invoke)?
  private var fileURL: URL?
  private weak var presenter: UIViewController?
  private weak var controller: UIViewController?
  private var documentInteraction: UIDocumentInteractionController?
  private var timer: DispatchWorkItem?
  private var resolved = false
  private var cancellations: [String: UInt64] = [:]
  private var cancelledAllAt: UInt64 = 0

  func execute(_ args: NativeFileActionArgs, invoke: Invoke, presenter: UIViewController?) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard active == nil, let presenter = presenter,
      presenter.presentedViewController == nil
    else {
      invoke.resolve(NativeFileActionResponse(
        requestId: args.requestId, state: "unavailable", reason: "file_presentation_busy"
      ))
      return
    }
    let now = UInt64(Date().timeIntervalSince1970 * 1000)
    cancellations = cancellations.filter { $0.value + 300_000 > now }
    guard cancellations[args.requestId] == nil,
      args.deadlineMs > cancelledAllAt + 300_000
    else {
      invoke.resolve(NativeFileActionResponse(
        requestId: args.requestId, state: "cancelled", reason: "file_action_stale"
      ))
      return
    }
    let url = URL(fileURLWithPath: args.localPath).standardizedFileURL.resolvingSymlinksInPath()
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
    guard args.deadlineMs > now, args.deadlineMs - now <= 300_000,
      caches.contains(where: {
        url.path.hasPrefix($0.standardizedFileURL.resolvingSymlinksInPath().path + "/")
      }), url.pathComponents.contains("peers-touch-file-handoff"),
      FileManager.default.fileExists(atPath: url.path),
      ["preview", "open_external", "save_copy"].contains(args.kind)
    else {
      invoke.resolve(NativeFileActionResponse(
        requestId: args.requestId, state: "failed", reason: "file_action_invalid"
      ))
      return
    }
    active = (args, invoke)
    resolved = false
    fileURL = url
    self.presenter = presenter
    let timeout = DispatchWorkItem { [weak self] in
      self?.finish("cancelled", reason: "file_action_expired", dismiss: true)
    }
    timer = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(args.deadlineMs - now) / 1000, execute: timeout)

    switch args.kind {
    case "preview":
      guard QLPreviewController.canPreview(url as NSURL) else {
        finish("unavailable", reason: "file_preview_unavailable")
        return
      }
      let preview = QLPreviewController()
      preview.dataSource = self
      preview.delegate = self
      controller = preview
      // Keep the invocation and its disposable source alive until dismissal.
      presenter.present(preview, animated: true)
    case "save_copy":
      let picker: UIDocumentPickerViewController
      if #available(iOS 14.0, *) {
        picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
      } else {
        picker = UIDocumentPickerViewController(url: url, in: .exportToService)
      }
      picker.delegate = self
      picker.presentationController?.delegate = self
      controller = picker
      presenter.present(picker, animated: true)
    default:
      let interaction = UIDocumentInteractionController(url: url)
      interaction.delegate = self
      documentInteraction = interaction
      let rect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
      if !interaction.presentOpenInMenu(from: rect, in: presenter.view, animated: true) {
        finish("unavailable", reason: "file_application_unavailable")
      }
    }
  }

  func cancel(_ requestId: String) {
    let now = UInt64(Date().timeIntervalSince1970 * 1000)
    cancellations = cancellations.filter { $0.value + 300_000 > now }
    if requestId.isEmpty || (cancellations[requestId] == nil && cancellations.count >= 256) {
      // Retained cancellations are fenced by this issuance watermark.
      cancelledAllAt = now
      cancellations.removeAll(keepingCapacity: true)
    } else {
      cancellations[requestId] = now
    }
    guard requestId.isEmpty || active?.args.requestId == requestId else { return }
    finish("cancelled", reason: nil, dismiss: true)
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    fileURL == nil ? 0 : 1
  }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    fileURL! as NSURL
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    finish("completed", reason: nil)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish("completed", reason: nil)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish("cancelled", reason: nil)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish("cancelled", reason: nil)
  }

  func documentInteractionController(
    _ controller: UIDocumentInteractionController, willBeginSendingToApplication application: String?
  ) {
    resolve("completed", reason: nil)
  }

  func documentInteractionControllerDidDismissOpenInMenu(_ controller: UIDocumentInteractionController) {
    finish("cancelled", reason: nil)
  }

  private func resolve(_ state: String, reason: String?) {
    guard !resolved, let active = active else { return }
    resolved = true
    active.invoke.resolve(NativeFileActionResponse(
      requestId: active.args.requestId, state: state, reason: reason
    ))
  }

  private func finish(_ state: String, reason: String?, dismiss: Bool = false) {
    resolve(state, reason: reason)
    timer?.cancel()
    timer = nil
    if dismiss {
      if let preview = controller as? QLPreviewController {
        preview.dataSource = nil
        preview.delegate = nil
      }
      controller?.dismiss(animated: false)
      documentInteraction?.dismissMenu(animated: false)
    }
    active = nil
    controller = nil
    documentInteraction = nil
    fileURL = nil
  }

  deinit {
    timer?.cancel()
  }
}
