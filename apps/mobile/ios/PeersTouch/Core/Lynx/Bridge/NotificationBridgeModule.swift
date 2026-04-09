import UserNotifications

struct NotificationBridgeModule: BridgeModule {
    let moduleName = "notification"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "show":
            return try await showNotification(params: params)
        case "cancel":
            guard let id = params?["id"] as? String else {
                throw BridgeError.invalidParams("Missing 'id' parameter")
            }
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
            return nil
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    private func showNotification(params: [String: Any]?) async throws -> [String: Any] {
        guard let title = params?["title"] as? String else {
            throw BridgeError.invalidParams("Missing 'title' parameter")
        }

        let notificationId = UUID().uuidString

        let content = UNMutableNotificationContent()
        content.title = title

        if let body = params?["content"] as? String {
            content.body = body
        }

        if let sound = params?["sound"] as? Bool, sound {
            content.sound = .default
        }

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let request = UNNotificationRequest(
            identifier: notificationId,
            content: content,
            trigger: trigger
        )

        try await UNUserNotificationCenter.current().add(request)
        return ["id": notificationId, "shown": true]
    }
}
