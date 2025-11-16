import 'package:dio/dio.dart';
import 'package:peers_touch_base/network/dio/model/network_error.dart';

class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final networkError = NetworkError(
      requestOptions: err.requestOptions,
      response: err.response,
      type: err.type,
      error: err.error,
    );
    handler.next(networkError);
  }
}