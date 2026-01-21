import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/ice/ice_server.dart';

class IceService {

  IceService({required IHttpService httpService}) : _httpService = httpService;

  final IHttpService _httpService;

  List<IceServer>? _cachedServers;
  DateTime? _cacheTime;

  static const Duration _cacheDuration = Duration(minutes: 5);

  Future<List<IceServer>> getICEServers({bool forceRefresh = false}) async {
    if (!forceRefresh && _cachedServers != null && _cacheTime != null) {
      final elapsed = DateTime.now().difference(_cacheTime!);
      if (elapsed < _cacheDuration) {
        return _cachedServers!;
      }
    }

    try {
      final response = await _httpService.getResponse<Map<String, dynamic>>(
        '/api/v1/turn/ice-servers',
      );

      final data = response.data;
      if (data != null && data['ice_servers'] is List) {
        final serverList = data['ice_servers'] as List;
        _cachedServers = serverList
            .whereType<Map<String, dynamic>>()
            .map((json) => IceServer.fromJson(json))
            .toList();
        _cacheTime = DateTime.now();
        return _cachedServers!;
      }
    } catch (_) {}

    return _getPublicFallback();
  }

  List<IceServer> _getPublicFallback() {
    return [
      IceServer(urls: ['stun:stun.l.google.com:19302']),
      IceServer(urls: ['stun:stun.qq.com:3478']),
      IceServer(urls: ['stun:stun.miwifi.com:3478']),
      IceServer(urls: ['stun:stun.xten.com']),
    ];
  }

  void clearCache() {
    _cachedServers = null;
    _cacheTime = null;
  }

  List<Map<String, dynamic>> toRTCConfiguration(List<IceServer> servers) {
    return servers.map((s) => s.toRTCIceServer()).toList();
  }
}
