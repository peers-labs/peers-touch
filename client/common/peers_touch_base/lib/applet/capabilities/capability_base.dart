
import '../bridge/protocol.dart';

abstract class AppletCapability {
  String get moduleName;

  /// Handle a request from the applet.
  Future<dynamic> handle(String action, Map<String, dynamic> params, String appId);
}
