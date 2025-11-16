import 'package:dio/dio.dart';

class AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    // Here you would get the token from a secure storage
    // For now, we'll just use a placeholder
    const String? token = null; // 'YOUR_BEARER_TOKEN';

    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }

    super.onRequest(options, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      // If a 401 response is received, refresh the token
      // and retry the original request.
      // For now, we just pass the error along.
    }
    super.onError(err, handler);
  }
}