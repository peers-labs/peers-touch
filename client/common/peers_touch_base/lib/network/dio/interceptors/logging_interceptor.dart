import 'package:dio/dio.dart';
import 'package:peers_touch_base/foundation.dart' if (dart.library.ui) 'package:flutter/foundation.dart';
import 'package:peers_touch_base/logger/logging_service.dart';

class LoggingInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kDebugMode) {
      LoggingService.debug('--> ${options.method} ${options.uri}');
      LoggingService.debug('Headers: ${options.headers}');
      LoggingService.debug('Query Parameters: ${options.queryParameters}');
      if (options.data != null) {
        LoggingService.debug('Body: ${options.data}');
      }
    }
    super.onRequest(options, handler);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (kDebugMode) {
      final logId = response.headers.value('x-log-id') ?? response.headers.value('X-Log-Id');
      LoggingService.debug('<-- ${response.statusCode} ${response.requestOptions.uri}');
      if (logId != null) {
        LoggingService.debug('Log-ID: $logId');
      }
      LoggingService.debug('Response: ${response.data}');
    }
    super.onResponse(response, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (kDebugMode) {
      final response = err.response;
      final logId = response?.headers.value('x-log-id') ?? response?.headers.value('X-Log-Id');
      LoggingService.error('<-- Error: ${err.error} - ${err.message}');
      if (response != null) {
        LoggingService.debug('Status: ${response.statusCode}');
        LoggingService.debug('Response Headers: ${response.headers.map}');
        LoggingService.debug('Response Body: ${response.data}');
      }
      if (logId != null) {
        LoggingService.debug('Log-ID: $logId');
      }
    }
    super.onError(err, handler);
  }
}