import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:logging/logging.dart';
import 'exceptions/exceptions.dart';
import 'request.dart';
import 'response.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/log_interceptor.dart';

/// Configuration for HTTP client
class HttpClientConfig {
  /// Base URL for all requests
  final String baseUrl;

  /// Connection timeout duration
  final Duration connectTimeout;

  /// Receive timeout duration
  final Duration receiveTimeout;

  /// Send timeout duration
  final Duration sendTimeout;

  /// Default headers to include with every request
  final Map<String, String> defaultHeaders;

  /// Whether to enable logging
  final bool enableLogging;

  /// Logging configuration
  final LoggingInterceptorConfig loggingConfig;

  /// Whether to enable authentication
  final bool enableAuth;

  /// Authentication configuration
  final AuthInterceptorConfig authConfig;

  /// Authentication token provider
  final AuthTokenProvider? authTokenProvider;

  /// Whether to validate SSL certificates
  final bool validateCertificates;

  /// HTTP proxy configuration
  final String? proxyUrl;

  /// Custom Dio instance (for advanced usage)
  final Dio? customDio;

  const HttpClientConfig({
    required this.baseUrl,
    this.connectTimeout = const Duration(seconds: 30),
    this.receiveTimeout = const Duration(seconds: 30),
    this.sendTimeout = const Duration(seconds: 30),
    this.defaultHeaders = const {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    this.enableLogging = true,
    this.loggingConfig = const LoggingInterceptorConfig(),
    this.enableAuth = false,
    this.authConfig = const AuthInterceptorConfig(),
    this.authTokenProvider,
    this.validateCertificates = true,
    this.proxyUrl,
    this.customDio,
  });
}

/// Main HTTP client wrapper using Dio
class HttpClient {
  late final Dio _dio;
  final HttpClientConfig config;
  final Logger _logger = Logger('HttpClient');

  HttpClient({
    required this.config,
  }) {
    _dio = config.customDio ?? Dio();
    _configureDio();
    _setupInterceptors();
  }

  /// Configure Dio instance with base settings
  void _configureDio() {
    _dio.options = BaseOptions(
      baseUrl: config.baseUrl,
      connectTimeout: config.connectTimeout,
      receiveTimeout: config.receiveTimeout,
      sendTimeout: config.sendTimeout,
      headers: config.defaultHeaders,
      validateStatus: (status) => status != null && status < 500,
    );

    // Configure SSL certificate validation
    if (!config.validateCertificates && _dio.httpClientAdapter is IOHttpClientAdapter) {
      (_dio.httpClientAdapter as IOHttpClientAdapter).onHttpClientCreate = (client) {
        client.badCertificateCallback = (cert, host, port) => true;
        return client;
      };
    }

    // Configure proxy if specified
    if (config.proxyUrl != null && _dio.httpClientAdapter is IOHttpClientAdapter) {
      (_dio.httpClientAdapter as IOHttpClientAdapter).onHttpClientCreate = (client) {
        client.findProxy = (uri) => 'PROXY ${config.proxyUrl}';
        return client;
      };
    }
  }

  /// Setup interceptors
  void _setupInterceptors() {
    // Add logging interceptor
    if (config.enableLogging) {
      _dio.interceptors.add(LoggingInterceptor(config: config.loggingConfig));
    }

    // Add authentication interceptor
    if (config.enableAuth && config.authTokenProvider != null) {
      _dio.interceptors.add(AuthInterceptor(
        tokenProvider: config.authTokenProvider!,
        config: config.authConfig,
      ));
    }

    // Add error handling interceptor
    _dio.interceptors.add(InterceptorsWrapper(
      onError: (error, handler) {
        final networkException = _convertToNetworkException(error);
        handler.reject(DioException(
          requestOptions: error.requestOptions,
          error: networkException,
          response: error.response,
          type: error.type,
        ));
      },
    ));
  }

  /// Convert DioException to NetworkException
  NetworkException _convertToNetworkException(DioException error) {
    final statusCode = error.response?.statusCode;
    final data = error.response?.data;

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return TimeoutException(
          message: 'Request timeout: ${error.message}',
          timeout: error.requestOptions.connectTimeout,
          data: data,
        );

      case DioExceptionType.badResponse:
        if (statusCode != null) {
          switch (statusCode) {
            case 400:
              return BadRequestException(
                message: 'Bad request: ${error.message}',
                data: data,
              );
            case 401:
              return UnauthorizedException(
                message: 'Unauthorized: ${error.message}',
                data: data,
              );
            case 403:
              return ForbiddenException(
                message: 'Forbidden: ${error.message}',
                data: data,
              );
            case 404:
              return NotFoundException(
                message: 'Not found: ${error.message}',
                data: data,
              );
            case 429:
              return RateLimitException(
                message: 'Rate limit exceeded: ${error.message}',
                data: data,
              );
            default:
              if (statusCode >= 400 && statusCode < 500) {
                return ClientException(
                  message: 'Client error: ${error.message}',
                  statusCode: statusCode,
                  data: data,
                );
              } else if (statusCode >= 500) {
                return ServerException(
                  message: 'Server error: ${error.message}',
                  statusCode: statusCode,
                  data: data,
                );
              }
          }
        }
        break;

      case DioExceptionType.cancel:
        return ConnectionException(
          message: 'Request cancelled: ${error.message}',
          data: data,
        );

      case DioExceptionType.connectionError:
        return ConnectionException(
          message: 'Connection error: ${error.message}',
          data: data,
        );

      default:
        return ConnectionException(
          message: 'Network error: ${error.message}',
          data: data,
        );
    }

    return NetworkException(
      message: 'Unknown error: ${error.message}',
      statusCode: statusCode,
      data: data,
    );
  }

  /// GET request
  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic)? fromJson,
  }) async {
    try {
      final response = await _dio.get(
        path,
        queryParameters: queryParameters,
        options: options,
      );
      return _handleResponse(response, fromJson);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// POST request
  Future<T> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic)? fromJson,
  }) async {
    try {
      final response = await _dio.post(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
      );
      return _handleResponse(response, fromJson);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// PUT request
  Future<T> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic)? fromJson,
  }) async {
    try {
      final response = await _dio.put(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
      );
      return _handleResponse(response, fromJson);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// DELETE request
  Future<T> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic)? fromJson,
  }) async {
    try {
      final response = await _dio.delete(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
      );
      return _handleResponse(response, fromJson);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// PATCH request
  Future<T> patch<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic)? fromJson,
  }) async {
    try {
      final response = await _dio.patch(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
      );
      return _handleResponse(response, fromJson);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// Upload file
  Future<T> uploadFile<T>(
    String path, {
    required File file,
    String? fileKey = 'file',
    Map<String, dynamic>? data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic)? fromJson,
    void Function(int, int)? onSendProgress,
  }) async {
    try {
      final formData = FormData();
      
      // Add file
      formData.files.add(MapEntry(
        fileKey ?? 'file',
        await MultipartFile.fromFile(file.path),
      ));

      // Add additional data
      if (data != null) {
        data.forEach((key, value) {
          formData.fields.add(MapEntry(key, value.toString()));
        });
      }

      final response = await _dio.post(
        path,
        data: formData,
        queryParameters: queryParameters,
        options: options,
        onSendProgress: onSendProgress,
      );

      return _handleResponse(response, fromJson);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// Download file
  Future<File> downloadFile(
    String urlPath, {
    required String savePath,
    Map<String, dynamic>? queryParameters,
    Options? options,
    void Function(int, int)? onReceiveProgress,
    bool deleteOnError = true,
  }) async {
    try {
      await _dio.download(
        urlPath,
        savePath,
        queryParameters: queryParameters,
        options: options,
        onReceiveProgress: onReceiveProgress,
        deleteOnError: deleteOnError,
      );

      return File(savePath);
    } on DioException catch (e) {
      throw e.error ?? e;
    }
  }

  /// Handle response and convert to desired type
  T _handleResponse<T>(Response response, T Function(dynamic)? fromJson) {
    if (fromJson != null) {
      return fromJson(response.data);
    }
    return response.data as T;
  }

  /// Create a new instance with different base URL
  HttpClient withBaseUrl(String baseUrl) {
    return HttpClient(config: HttpClientConfig(
      baseUrl: baseUrl,
      connectTimeout: config.connectTimeout,
      receiveTimeout: config.receiveTimeout,
      sendTimeout: config.sendTimeout,
      defaultHeaders: config.defaultHeaders,
      enableLogging: config.enableLogging,
      loggingConfig: config.loggingConfig,
      enableAuth: config.enableAuth,
      authConfig: config.authConfig,
      authTokenProvider: config.authTokenProvider,
      validateCertificates: config.validateCertificates,
      proxyUrl: config.proxyUrl,
    ));
  }

  /// Add default header
  void addDefaultHeader(String key, String value) {
    _dio.options.headers[key] = value;
  }

  /// Remove default header
  void removeDefaultHeader(String key) {
    _dio.options.headers.remove(key);
  }

  /// Update default headers
  void updateDefaultHeaders(Map<String, String> headers) {
    _dio.options.headers.addAll(headers);
  }

  /// Get Dio instance for advanced usage
  Dio get dio => _dio;

  /// Close the HTTP client and clean up resources
  void close() {
    _dio.close();
  }
}