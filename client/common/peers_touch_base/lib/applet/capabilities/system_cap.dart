
import 'package:peers_touch_base/applet/capabilities/capability_base.dart';

class SystemCapability extends AppletCapability {
  @override
  String get moduleName => 'system';

  @override
  Future<dynamic> handle(String action, Map<String, dynamic> params, String appId) async {
    switch (action) {
      case 'toast':
        return _handleToast(params, appId);
      default:
        throw Exception('Unknown action: $action');
    }
  }

  Future<void> _handleToast(Map<String, dynamic> params, String appId) async {
    final message = params['message'];
    // TODO: Show toast using BotToast or SnackBar
    print('Applet $appId showing toast: $message');
  }
}
