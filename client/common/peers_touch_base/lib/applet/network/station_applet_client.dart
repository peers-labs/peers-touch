import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class StationAppletClient {
  static final StationAppletClient _instance = StationAppletClient._internal();
  factory StationAppletClient() => _instance;
  StationAppletClient._internal();

  String get _basePath => '/api/v1/applets';

  Future<List<AppletManifest>> fetchAppletList({int limit = 20, int offset = 0}) async {
    try {
      final http = HttpServiceLocator().httpService;
      final response = await http.get<List<dynamic>>(
        _basePath,
        queryParameters: {
          'limit': limit,
          'offset': offset,
        },
      );

      return response.map((json) {
        // Map backend Applet model to AppletManifest
        // Backend response format matches existing AppletManifest structure largely
        // but we need to ensure fields map correctly
        return AppletManifest.fromJson(_adaptBackendResponse(json));
      }).toList();
    } catch (e) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getAppletDetails(String appId) async {
    try {
      final http = HttpServiceLocator().httpService;
      final response = await http.get<Map<String, dynamic>>(
        '$_basePath/details',
        queryParameters: {
          'id': appId,
        },
      );
      return response;
    } catch (e) {
      rethrow;
    }
  }

  // Helper to adapt backend response to AppletManifest if needed
  Map<String, dynamic> _adaptBackendResponse(Map<String, dynamic> json) {
    // Map backend 'latest_version_url' to 'entry_point' or 'bundle_url' logic
    // Currently AppletManifest uses 'entry_point' for local logic, 
    // but here we might receive 'latest_version_url' which is the download/template link.
    
    // Check if we have computed URL from backend
    if (json.containsKey('latest_version_url')) {
       // We store the remote URL in 'entry_point' for now as it serves as the loadable resource
       // In a real scenario, we might want separate fields for 'remote_url' and 'local_entry_point'
       json['entry_point'] = json['latest_version_url'];
    }
    
    // Ensure permissions is a list
    if (json['permissions'] == null) {
      json['permissions'] = <String>[];
    }
    
    // Map 'id' to 'appId' if needed, though usually backend uses 'id' and manifest uses 'appId'
    if (json['id'] != null && json['appId'] == null) {
      json['appId'] = json['id'];
    }
    
    // Add default version if missing (from list view)
    if (json['version'] == null) {
        json['version'] = '1.0.0'; // Default or fetched from latest_version struct
    }

    return json;
  }
}
