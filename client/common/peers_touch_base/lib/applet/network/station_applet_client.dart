import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_base/model/domain/applet/applet.pb.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class StationAppletClient {
  factory StationAppletClient() => _instance;
  StationAppletClient._internal();
  static final StationAppletClient _instance = StationAppletClient._internal();

  String get _basePath => '/api/v1/applets';

  Future<List<AppletManifest>> fetchAppletList({int limit = 20, int offset = 0}) async {
    try {
      final http = HttpServiceLocator().httpService;
      final request = ListAppletsRequest()
        ..limit = limit
        ..offset = offset;
      
      final response = await http.post<ListAppletsResponse>(
        _basePath,
        data: request,
        fromJson: (bytes) => ListAppletsResponse.fromBuffer(bytes),
      );

      return response.applets.map((appletInfo) {
        return AppletManifest.fromJson(_adaptProtoToManifest(appletInfo));
      }).toList();
    } catch (e) {
      rethrow;
    }
  }

  Future<GetAppletDetailsResponse> getAppletDetails(String appId) async {
    try {
      final http = HttpServiceLocator().httpService;
      final request = GetAppletDetailsRequest()..appletId = appId;
      
      final response = await http.post<GetAppletDetailsResponse>(
        '$_basePath/details',
        data: request,
        fromJson: (bytes) => GetAppletDetailsResponse.fromBuffer(bytes),
      );
      return response;
    } catch (e) {
      rethrow;
    }
  }

  Map<String, dynamic> _adaptProtoToManifest(AppletInfo appletInfo) {
    return {
      'appId': appletInfo.id,
      'id': appletInfo.id,
      'name': appletInfo.name,
      'description': appletInfo.description,
      'icon_url': appletInfo.iconUrl,
      'entry_point': '',
      'version': appletInfo.latestVersion,
      'permissions': <String>[],
      'developer_id': appletInfo.developerId,
      'download_count': appletInfo.downloadCount,
    };
  }
}
