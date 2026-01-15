import 'package:dio/dio.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/network/token_refresher.dart';

/// HTTP服务定位器 - 实现单例模式和BaseURL动态更新
class HttpServiceLocator {

  /// 工厂构造函数 - 返回单例
  factory HttpServiceLocator() {
    return _instance;
  }

  /// 私有构造函数
  HttpServiceLocator._internal();
  static final HttpServiceLocator _instance = HttpServiceLocator._internal();
  late IHttpService _httpService;
  late String _baseUrl;
  
  HttpClientAdapter? _adapter;
  List<Interceptor>? _interceptors;
  TokenProvider? _tokenProvider;
  TokenRefresher? _tokenRefresher;
  void Function()? _onUnauthenticated;

  /// 初始化HTTP服务
  void initialize({
    required String baseUrl,
    HttpClientAdapter? adapter,
    List<Interceptor>? interceptors,
    TokenProvider? tokenProvider,
    TokenRefresher? tokenRefresher,
    void Function()? onUnauthenticated,
  }) {
    _baseUrl = baseUrl;
    _adapter = adapter;
    _interceptors = interceptors;
    _tokenProvider = tokenProvider;
    _tokenRefresher = tokenRefresher;
    _onUnauthenticated = onUnauthenticated;

    _httpService = HttpServiceImpl(
      baseUrl: baseUrl,
      httpClientAdapter: adapter,
      interceptors: interceptors,
      tokenProvider: tokenProvider,
      tokenRefresher: tokenRefresher,
      onUnauthenticated: onUnauthenticated,
    );
  }

  /// 设置认证提供者
  void setAuthProviders({
    TokenProvider? tokenProvider,
    TokenRefresher? tokenRefresher,
    void Function()? onUnauthenticated,
  }) {
    _tokenProvider = tokenProvider;
    _tokenRefresher = tokenRefresher;
    if (onUnauthenticated != null) {
      _onUnauthenticated = onUnauthenticated;
    }
    
    // Re-initialize service to apply changes
    if (_isInitialized()) {
      _httpService = HttpServiceImpl(
        baseUrl: _baseUrl,
        httpClientAdapter: _adapter,
        interceptors: _interceptors,
        tokenProvider: _tokenProvider,
        tokenRefresher: _tokenRefresher,
        onUnauthenticated: _onUnauthenticated,
      );
    }
  }

  /// 获取HTTP服务实例
  IHttpService get httpService {
    // Note: This check relies on _baseUrl being initialized. 
    // If not initialized, accessing _baseUrl throws LateInitializationError.
    // Ideally we should have a flag.
    return _httpService; 
  }

  /// 更新BaseURL
  void updateBaseUrl(String newBaseUrl) {
    _baseUrl = newBaseUrl;
    // 如果是HttpServiceImpl实例，使用公共方法更新baseUrl
    if (_httpService is HttpServiceImpl) {
      (httpService as HttpServiceImpl).setBaseUrl(newBaseUrl);
    } else {
      // 对于其他实现，重新初始化服务（保留认证配置）
      _httpService = HttpServiceImpl(
        baseUrl: newBaseUrl,
        httpClientAdapter: _adapter,
        interceptors: _interceptors,
        tokenProvider: _tokenProvider,
        tokenRefresher: _tokenRefresher,
        onUnauthenticated: _onUnauthenticated,
      );
    }
  }
  
  /// 检查是否已初始化
  bool _isInitialized() {
    try {
      return _baseUrl.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// 获取当前BaseURL
  String get baseUrl => _baseUrl;
  
  /// 获取 TokenProvider
  TokenProvider? get tokenProvider => _tokenProvider;
  
  /// 获取 TokenRefresher
  TokenRefresher? get tokenRefresher => _tokenRefresher;
}
