import 'package:dio/dio.dart';

import 'package:peers_touch_desktop/core/network/interceptors/auth_interceptor.dart';
import 'package:peers_touch_desktop/core/network/interceptors/retry_interceptor.dart';
import 'package:peers_touch_desktop/core/network/interceptors/token_refresh_interceptor.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';
import 'package:peers_touch_desktop/core/network/api_exception.dart';
import 'package:peers_touch_desktop/core/network/network_status_service.dart';
import 'package:peers_touch_desktop/core/network/token_refresh_handler.dart';

class ApiClient {
  final Dio dio;
  final SecureStorage? secureStorage;
  final NetworkStatusService? networkStatusService;
  final TokenRefreshHandler? tokenRefreshHandler;

  ApiClient({this.secureStorage, this.networkStatusService, this.tokenRefreshHandler})
      : dio = Dio(
          BaseOptions(
            connectTimeout: const Duration(seconds: 30),
            receiveTimeout: const Duration(seconds: 30),
          ),
        ) {
    dio.interceptors.add(LogInterceptor(responseBody: false));
    if (secureStorage != null) {
      dio.interceptors.add(AuthInterceptor(secureStorage: secureStorage!));
    }
    dio.interceptors.add(RetryInterceptor(dio: dio, networkStatusService: networkStatusService));
    if (secureStorage != null && tokenRefreshHandler != null) {
      dio.interceptors.add(
        TokenRefreshInterceptor(
          dio: dio,
          secureStorage: secureStorage!,
          refreshHandler: tokenRefreshHandler!,
        ),
      );
    }
  }

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? query,
    Options? options,
    CancelToken? cancelToken,
  }) async {
    try {
      return await dio.get<T>(
        path,
        queryParameters: query,
        options: options,
        cancelToken: cancelToken,
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? query,
    Options? options,
    CancelToken? cancelToken,
  }) async {
    try {
      return await dio.post<T>(
        path,
        data: data,
        queryParameters: query,
        options: options,
        cancelToken: cancelToken,
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  ApiException _mapException(DioException e) {
    final status = e.response?.statusCode;
    final message = e.message ?? 'Network error';
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return ApiException('Request timeout', statusCode: status);
      case DioExceptionType.badResponse:
        return ApiException('HTTP $status', statusCode: status);
      case DioExceptionType.connectionError:
        return ApiException('Connection error', statusCode: status);
      default:
        return ApiException(message, statusCode: status);
    }
  }
}