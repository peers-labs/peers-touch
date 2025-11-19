import 'package:peers_touch_base/network/dio/http_service_locator.dart';

/// 网络服务初始化器
class NetworkInitializer {
  /// 初始化网络服务
  /// [baseUrl] - 默认API基础地址
  static void initialize({required String baseUrl}) {
    HttpServiceLocator().initialize(baseUrl: baseUrl);
  }

  /// 获取当前基础URL
  static String get currentBaseUrl {
    return HttpServiceLocator().baseUrl;
  }

  /// 更新基础URL
  static void updateBaseUrl(String newBaseUrl) {
    HttpServiceLocator().updateBaseUrl(newBaseUrl);
  }
}