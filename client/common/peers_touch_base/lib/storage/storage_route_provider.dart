import 'dart:convert';
import 'package:get/get.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

/// 路由解析接口（约定优先，配置可覆盖）
abstract class RouteProvider {
  /// 解析最终请求 URL
  Uri resolve(
    String resourceCode, {
    String? id,
    String? action,
    Map<String, dynamic>? query,
  });
}

/// 约定式路由：baseUrl + '/touch/{resourceCode}'，支持本地配置覆盖
class ConventionalRouteProvider implements RouteProvider {
  final LocalStorage _localStorage = Get.find<LocalStorage>();

  /// routes 覆盖键（JSON 字符串）
  static const String _routesKey = 'storage:routes';
  static const String _backendUrlKey = 'settings:global_business:backend_url';

  @override
  Uri resolve(
    String resourceCode, {
    String? id,
    String? action,
    Map<String, dynamic>? query,
  }) {
    final base = _normalizeBaseUrl(_localStorage.get<String>(_backendUrlKey) ?? '');

    // 解析覆盖配置
    String path = '/touch/$resourceCode';
    final routesJson = _localStorage.get<String>(_routesKey);
    if (routesJson != null && routesJson.isNotEmpty) {
      try {
        final Map<String, dynamic> map = jsonDecode(routesJson);
        final override = map[resourceCode];
        if (override is String && override.trim().isNotEmpty) {
          path = override.startsWith('/') ? override : '/$override';
        }
      } catch (_) {
        // ignore parse error
      }
    }

    if (id != null && id.isNotEmpty) {
      path = '$path/$id';
    }
    if (action != null && action.isNotEmpty) {
      path = '$path/$action';
    }

    final baseUri = Uri.parse(base);
    return baseUri.resolve(path).replace(queryParameters: query);
  }

  String _normalizeBaseUrl(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return 'http://localhost:8080';
    final hasScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://');
    final url = hasScheme ? trimmed : 'http://$trimmed';
    try {
      final uri = Uri.parse(url);
      if (uri.scheme.isEmpty) return 'http://localhost:8080';
      return url;
    } catch (_) {
      return 'http://localhost:8080';
    }
  }
}