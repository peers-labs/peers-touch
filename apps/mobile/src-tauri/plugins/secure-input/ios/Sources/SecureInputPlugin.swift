import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit

private let acceptanceSecretFileEnvironment =
  "PEERS_TOUCH_ACCEPTANCE_RECOVERY_SECRET_FILE"
private let privateSocialRecoveryPurpose = "private_social_recovery"
private let maximumSecretBytes = 1024

private struct SecretInputArgs: Decodable {
  let requestId: String
  let purpose: String
  let lifecycleGeneration: Int
  let deadlineMs: Int
  let acceptanceAutofillAllowed: Bool
}

private struct SecretInputResponse: Encodable {
  let requestId: String
  let lifecycleGeneration: Int
  let outcome: String
  let secret: String?
  let errorCode: String?
}

private final class ActiveSecretInput {
  let args: SecretInputArgs
  let invoke: Invoke
  let alert: UIAlertController
  let field: UITextField
  var deadline: DispatchWorkItem?

  init(
    args: SecretInputArgs,
    invoke: Invoke,
    alert: UIAlertController,
    field: UITextField
  ) {
    self.args = args
    self.invoke = invoke
    self.alert = alert
    self.field = field
  }
}

final class SecureInputPlugin: Plugin {
  private var activeInput: ActiveSecretInput?

  @objc public func requestSecret(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SecretInputArgs.self)
      guard
        !args.requestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        args.purpose == privateSocialRecoveryPurpose,
        args.lifecycleGeneration > 0,
        args.deadlineMs >= 1_000,
        args.deadlineMs <= 300_000
      else {
        invoke.reject(
          "invalid native secure-input request",
          code: "SECURE_INPUT_INVALID_REQUEST"
        )
        return
      }
      DispatchQueue.main.async { [weak self] in
        self?.present(args: args, invoke: invoke)
      }
    } catch {
      invoke.reject(
        "invalid native secure-input request",
        code: "SECURE_INPUT_INVALID_REQUEST"
      )
    }
  }

  private func present(args: SecretInputArgs, invoke: Invoke) {
    guard activeInput == nil else {
      resolve(
        invoke,
        args: args,
        outcome: "busy",
        errorCode: "SECURE_INPUT_BUSY"
      )
      return
    }
    guard let presenter = topViewController() else {
      resolve(
        invoke,
        args: args,
        outcome: "platform_failure",
        errorCode: "SECURE_INPUT_PRESENTATION_UNAVAILABLE"
      )
      return
    }

    let alert = UIAlertController(
      title: localized("recovery_title"),
      message: localized("recovery_message"),
      preferredStyle: .alert
    )
    alert.view.accessibilityIdentifier = "peers-touch.secure-input.recovery"
    alert.addTextField { [weak self] field in
      field.isSecureTextEntry = true
      field.textContentType = .password
      field.autocorrectionType = .no
      field.autocapitalizationType = .none
      field.placeholder = self?.localized("recovery_placeholder")
      field.accessibilityIdentifier = "peers-touch.secure-input.recovery-field"
      if args.acceptanceAutofillAllowed,
         ProcessInfo.processInfo.environment[acceptanceSecretFileEnvironment] != nil
      {
        field.accessibilityCustomActions = [
          UIAccessibilityCustomAction(
            name: self?.localized("acceptance_autofill") ?? "Fill recovery phrase",
            target: self,
            selector: #selector(SecureInputPlugin.autofillAcceptanceSecret)
          ),
        ]
      }
    }
    guard let field = alert.textFields?.first else {
      resolve(
        invoke,
        args: args,
        outcome: "platform_failure",
        errorCode: "SECURE_INPUT_FIELD_UNAVAILABLE"
      )
      return
    }

    alert.addAction(UIAlertAction(
      title: localized("cancel"),
      style: .cancel,
      handler: { [weak self] _ in
        self?.complete(outcome: "cancelled", errorCode: nil)
      }
    ))
    alert.addAction(UIAlertAction(
      title: localized("recover"),
      style: .default,
      handler: { [weak self, weak field] _ in
        self?.complete(
          outcome: "submitted",
          secret: field?.text ?? "",
          errorCode: nil
        )
      }
    ))

    let active = ActiveSecretInput(
      args: args,
      invoke: invoke,
      alert: alert,
      field: field
    )
    let deadline = DispatchWorkItem { [weak self] in
      self?.complete(
        outcome: "expired",
        errorCode: "SECURE_INPUT_EXPIRED"
      )
    }
    active.deadline = deadline
    activeInput = active
    presenter.present(alert, animated: true)
    DispatchQueue.main.asyncAfter(
      deadline: .now() + .milliseconds(args.deadlineMs),
      execute: deadline
    )
  }

  @objc private func autofillAcceptanceSecret() -> Bool {
    guard
      let active = activeInput,
      active.args.acceptanceAutofillAllowed,
      let secret = consumeAcceptanceSecret()
    else {
      return false
    }
    active.field.text = secret
    return true
  }

  private func complete(
    outcome: String,
    secret: String? = nil,
    errorCode: String?
  ) {
    guard let active = activeInput else { return }
    activeInput = nil
    active.deadline?.cancel()
    active.field.text = nil
    active.field.accessibilityCustomActions = nil
    active.alert.dismiss(animated: true)
    resolve(
      active.invoke,
      args: active.args,
      outcome: outcome,
      secret: secret,
      errorCode: errorCode
    )
  }

  private func consumeAcceptanceSecret() -> String? {
    guard
      let path = ProcessInfo.processInfo.environment[acceptanceSecretFileEnvironment],
      !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    let url = URL(fileURLWithPath: path)
    defer {
      try? FileManager.default.removeItem(at: url)
    }
    var data: Data
    do {
      data = try Data(contentsOf: url, options: [.mappedIfSafe])
    } catch {
      return nil
    }
    defer {
      data.resetBytes(in: 0..<data.count)
    }
    guard
      !data.isEmpty,
      data.count <= maximumSecretBytes,
      let secret = String(data: data, encoding: .utf8),
      !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    return secret
  }

  private func resolve(
    _ invoke: Invoke,
    args: SecretInputArgs,
    outcome: String,
    secret: String? = nil,
    errorCode: String?
  ) {
    invoke.resolve(SecretInputResponse(
      requestId: args.requestId,
      lifecycleGeneration: args.lifecycleGeneration,
      outcome: outcome,
      secret: secret,
      errorCode: errorCode
    ))
  }

  private func localized(_ key: String) -> String {
    Bundle.module.localizedString(forKey: key, value: key, table: nil)
  }

  private func topViewController() -> UIViewController? {
    let root = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController
    var current = root
    while let presented = current?.presentedViewController {
      current = presented
    }
    return current
  }
}

@_cdecl("init_plugin_secure_input")
func initPlugin() -> Plugin {
  SecureInputPlugin()
}
