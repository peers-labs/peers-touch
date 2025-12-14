import 'package:dio/dio.dart';
import 'http_service.dart';
import 'http_service_impl.dart';

/// HTTP服务定位器 - 实现单例模式和BaseURL动态更新
class HttpServiceLocator {
  static final HttpServiceLocator _instance = HttpServiceLocator._internal();
  late IHttpService _httpService;
  late String _baseUrl;

  /// 工厂构造函数 - 返回单例
  factory HttpServiceLocator() {
    return _instance;
  }

  /// 私有构造函数
  HttpServiceLocator._internal();

  /// 初始化HTTP服务
  void initialize({
    required String baseUrl,
    HttpClientAdapter? adapter,
    List<Interceptor>? interceptors,
  }) {
    _baseUrl = baseUrl;
    _httpService = HttpServiceImpl(
      baseUrl: baseUrl,
      httpClientAdapter: adapter,
      interceptors: interceptors,
    );
  }

  /// 获取HTTP服务实例
  IHttpService get httpService {
    if (!_isInitialized()) {
      throw Exception('HttpServiceLocator has not been initialized. Call initialize() first.');
    }
    return _httpService;
  }

  /// 更新BaseURL
  void updateBaseUrl(String newBaseUrl) {
    if (!_isInitialized()) {
      throw Exception('HttpServiceLocator has not been initialized. Call initialize() first.');
    }

    _baseUrl = newBaseUrl;
    // 如果是HttpServiceImpl实例，使用公共方法更新baseUrl
    if (_httpService is HttpServiceImpl) {
      (httpService as HttpServiceImpl).setBaseUrl(newBaseUrl);
    } else {
      // 对于其他实现，重新初始化服务
      _httpService = HttpServiceImpl(baseUrl: newBaseUrl);
    }
  }

  /// 检查是否已初始化
  bool _isInitialized() {
    return _baseUrl.isNotEmpty;
  }

  /// 获取当前BaseURL
  String get baseUrl => _baseUrl;
}