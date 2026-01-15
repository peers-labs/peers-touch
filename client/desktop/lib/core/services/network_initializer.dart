import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/network/token_refresher.dart';

/// 网络服务初始化器
class NetworkInitializer {
  /// 初始化网络服务
  /// [baseUrl] - 默认API基础地址
  static void initialize({required String baseUrl}) {
    try {
      final currentBaseUrl = HttpServiceLocator().baseUrl;
      if (currentBaseUrl.isNotEmpty && HttpServiceLocator().tokenProvider != null) {
        HttpServiceLocator().updateBaseUrl(baseUrl);
      } else {
        HttpServiceLocator().initialize(baseUrl: baseUrl);
      }
    } catch (_) {
      HttpServiceLocator().initialize(baseUrl: baseUrl);
    }
  }

  /// 设置认证相关提供者
  static void setupAuth({
    TokenProvider? tokenProvider,
    TokenRefresher? tokenRefresher,
    void Function()? onUnauthenticated,
  }) {
    HttpServiceLocator().setAuthProviders(
      tokenProvider: tokenProvider,
      tokenRefresher: tokenRefresher,
      onUnauthenticated: onUnauthenticated,
    );
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
