
abstract class AppletGuard {
  /// Check if the request is allowed.
  /// Returns true if allowed, false otherwise.
  Future<bool> onRequest(String appId, String module, String action, Map<String, dynamic> params);
}

class DefaultAppletGuard implements AppletGuard {
  @override
  Future<bool> onRequest(String appId, String module, String action, Map<String, dynamic> params) async {
    // Default implementation allows all requests.
    // In the future, this can be extended to support permissions, whitelists, etc.
    return true;
  }
}
