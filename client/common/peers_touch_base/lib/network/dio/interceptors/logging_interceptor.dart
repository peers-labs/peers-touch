import 'package:dio/dio.dart';
import 'package:peers_touch_base/foundation.dart' if (dart.library.ui) 'package:flutter/foundation.dart';

class LoggingInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kDebugMode) {
      print('--> ${options.method} ${options.uri}');
      print('Headers: ${options.headers}');
      print('Query Parameters: ${options.queryParameters}');
      if (options.data != null) {
        print('Body: ${options.data}');
      }
    }
    super.onRequest(options, handler);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (kDebugMode) {
      final logId = response.headers.value('x-log-id') ?? response.headers.value('X-Log-Id');
      print('<-- ${response.statusCode} ${response.requestOptions.uri}');
      if (logId != null) {
        print('Log-ID: $logId');
      }
      print('Response: ${response.data}');
    }
    super.onResponse(response, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (kDebugMode) {
      final logId = err.response?.headers.value('x-log-id') ?? err.response?.headers.value('X-Log-Id');
      print('<-- Error: ${err.error} - ${err.message}');
      if (logId != null) {
        print('Log-ID: $logId');
      }
    }
    super.onError(err, handler);
  }
}