import 'dart:typed_data';

import 'package:dio/dio.dart';

typedef ProtoFactory<T> = T Function(List<int> bytes);

abstract class IHttpService {
  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    ProtoFactory<T>? fromJson,
  });

  Future<T> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    ProtoFactory<T>? fromJson,
  });

  Future<T> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    ProtoFactory<T>? fromJson,
  });

  Future<T> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    ProtoFactory<T>? fromJson,
  });

  Future<T> patch<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    ProtoFactory<T>? fromJson,
  });

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

  Future<Response<T>> patchResponse<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  });
}
