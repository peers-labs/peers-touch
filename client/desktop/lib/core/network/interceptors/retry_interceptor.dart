import 'dart:math';

import 'package:dio/dio.dart';
import 'package:peers_touch_desktop/core/network/network_status_service.dart';

class RetryInterceptor extends Interceptor {
  final Dio dio;
  final int maxRetries;
  final int initialDelayMs;
  final NetworkStatusService? networkStatusService;

  RetryInterceptor({
    required this.dio,
    this.maxRetries = 2,
    this.initialDelayMs = 200,
    this.networkStatusService,
  });

  bool _shouldRetry(DioException err) {
    final method = err.requestOptions.method.toUpperCase();
    final status = err.response?.statusCode ?? 0;
    final type = err.type;
    final isNetworkIssue = type == DioExceptionType.connectionError ||
        type == DioExceptionType.connectionTimeout ||
        type == DioExceptionType.receiveTimeout ||
        type == DioExceptionType.badCertificate;
    final isServerError = status >= 500 && status < 600;
    return method == 'GET' && (isNetworkIssue || isServerError);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final opts = err.requestOptions;
    final retries = (opts.extra['retries'] as int?) ?? 0;
    if (_shouldRetry(err) && retries < maxRetries) {
      if (networkStatusService != null) {
        final online = await networkStatusService!.isOnline();
        if (!online) {
          return handler.next(err);
        }
      }
      opts.extra['retries'] = retries + 1;
      final delayMs = initialDelayMs * pow(2, retries).toInt();
      await Future.delayed(Duration(milliseconds: delayMs));
      try {
        final response = await dio.fetch(opts);
        return handler.resolve(response);
      } catch (e) {
        return handler.next(err);
      }
    }
    handler.next(err);
  }
}