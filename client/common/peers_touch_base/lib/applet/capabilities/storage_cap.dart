
import 'capability_base.dart';

class StorageCapability extends AppletCapability {
  @override
  String get moduleName => 'storage';

  @override
  Future<dynamic> handle(String action, Map<String, dynamic> params, String appId) async {
    switch (action) {
      case 'set':
        return _handleSet(params, appId);
      case 'get':
        return _handleGet(params, appId);
      default:
        throw Exception("Unknown action: $action");
    }
  }

  Future<void> _handleSet(Map<String, dynamic> params, String appId) async {
    final key = params['key'];
    final value = params['value'];
    // TODO: Save to SharedPrefs/Hive with prefix "applet_${appId}_$key"
    print("Applet $appId setting storage $key=$value");
  }

  Future<dynamic> _handleGet(Map<String, dynamic> params, String appId) async {
    final key = params['key'];
    // TODO: Read from SharedPrefs/Hive with prefix
    return "Mock Value";
  }
}
