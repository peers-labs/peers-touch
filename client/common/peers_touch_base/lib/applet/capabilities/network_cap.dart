
import 'package:peers_touch_base/applet/capabilities/capability_base.dart';

class NetworkCapability extends AppletCapability {
  @override
  String get moduleName => 'network';

  @override
  Future<dynamic> handle(String action, Map<String, dynamic> params, String appId) async {
    switch (action) {
      case 'request':
        return _handleRequest(params, appId);
      default:
        throw Exception('Unknown action: $action');
    }
  }

  Future<dynamic> _handleRequest(Map<String, dynamic> params, String appId) async {
    final url = params['url'];
    final method = params['method'] ?? 'GET';
    // TODO: Use global Dio client to make request
    // Ensure we add Authorization header and other common headers
    print('Applet $appId requesting $method $url');
    return {'status': 200, 'data': 'Mock Response'};
  }
}
