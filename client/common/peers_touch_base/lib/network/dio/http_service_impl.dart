import 'package:dio/dio.dart';
import 'package:peers_touch_base/foundation.dart' if (dart.library.ui) 'package:flutter/foundation.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/interceptors/auth_interceptor.dart';
import 'package:peers_touch_base/network/dio/interceptors/error_interceptor.dart';
import 'package:peers_touch_base/network/dio/interceptors/logging_interceptor.dart';
import 'package:peers_touch_base/network/dio/interceptors/retry_interceptor.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/network/token_refresher.dart';

class HttpServiceImpl implements IHttpService {
  late final Dio _dio;

  HttpServiceImpl({
    required String baseUrl,
    HttpClientAdapter? httpClientAdapter,
    List<Interceptor>? interceptors,
    TokenProvider? tokenProvider,
    TokenRefresher? tokenRefresher,
  }) {
    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
      ),
    );

    if (httpClientAdapter != null) {
      _dio.httpClientAdapter = httpClientAdapter;
    }

    _dio.interceptors.addAll([
      if (kDebugMode) LoggingInterceptor(),
      ...?interceptors,
      if (interceptors?.any((i) => i is AuthInterceptor) != true) 
        AuthInterceptor(tokenProvider: tokenProvider, tokenRefresher: tokenRefresher),
      createRetryInterceptor(_dio),
      ErrorInterceptor(),
    ]);
  }

  /// 更新基础URL
  void setBaseUrl(String newBaseUrl) {
    _dio.options.baseUrl = newBaseUrl;
  }

  @override
  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await getResponse<T>(path, queryParameters: queryParameters);
    return response.data as T;
  }

  @override
  Future<T> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await postResponse<T>(path, data: data, queryParameters: queryParameters);
    return response.data as T;
  }

  @override
  Future<T> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await putResponse<T>(path, data: data, queryParameters: queryParameters);
    return response.data as T;
  }

  @override
  Future<T> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await deleteResponse<T>(path, data: data, queryParameters: queryParameters);
    return response.data as T;
  }

  @override
  Future<Response<T>> getResponse<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    return await _dio.get<T>(
      path,
      queryParameters: queryParameters,
    );
  }

  @override
  Future<Response<T>> postResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    return await _dio.post<T>(
      path,
      data: data,
      queryParameters: queryParameters,
    );
  }

  @override
  Future<Response<T>> putResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    return await _dio.put<T>(
      path,
      data: data,
      queryParameters: queryParameters,
    );
  }

  @override
  Future<Response<T>> deleteResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    return await _dio.delete<T>(
      path,
      data: data,
      queryParameters: queryParameters,
    );
  }
}
