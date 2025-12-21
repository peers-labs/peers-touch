import 'package:dio/dio.dart';

abstract class IHttpService {
  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  });

  Future<T> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });

  Future<T> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });

  Future<T> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });

  // Methods returning full Response object

  Future<Response<T>> getResponse<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  });

  Future<Response<T>> postResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });

  Future<Response<T>> putResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });

  Future<Response<T>> deleteResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });
}
