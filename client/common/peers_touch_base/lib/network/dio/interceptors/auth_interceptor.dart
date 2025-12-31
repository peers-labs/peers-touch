import 'package:dio/dio.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/network/token_refresher.dart';

class AuthInterceptor extends Interceptor {

  AuthInterceptor({this.tokenProvider, this.tokenRefresher, this.onUnauthenticated});
  final TokenProvider? tokenProvider;
  final TokenRefresher? tokenRefresher;
  final void Function()? onUnauthenticated;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (tokenProvider != null) {
      try {
        final token = await tokenProvider!.readAccessToken();
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
      } catch (_) {
        // Ignore errors reading token
      }
    }
    super.onRequest(options, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final status = err.response?.statusCode;
    final opts = err.requestOptions;

    // Check if we should try to refresh
    if (status == 401) {
      if (tokenProvider != null && 
          tokenRefresher != null && 
          opts.extra['retryAfterRefresh'] != true) {
        
        opts.extra['retryAfterRefresh'] = true;

        try {
          final refreshToken = await tokenProvider!.readRefreshToken();
          if (refreshToken == null) {
            onUnauthenticated?.call();
            return handler.next(err);
          }

          final newPair = await tokenRefresher!.refresh(refreshToken);
          if (newPair == null) {
            onUnauthenticated?.call();
            return handler.next(err);
          }

          await tokenProvider!.writeTokens(
            accessToken: newPair.accessToken,
            refreshToken: newPair.refreshToken,
          );

          // Update the header with the new token
          final newHeaders = Map<String, dynamic>.from(opts.headers);
          newHeaders['Authorization'] = 'Bearer ${newPair.accessToken}';
          opts.headers = newHeaders;

          // Retry the request
          final dio = Dio(BaseOptions(
            baseUrl: opts.baseUrl,
            connectTimeout: opts.connectTimeout,
            receiveTimeout: opts.receiveTimeout,
            sendTimeout: opts.sendTimeout,
          ));
          
          final response = await dio.fetch(opts);
          return handler.resolve(response);

        } catch (_) {
          onUnauthenticated?.call();
          return handler.next(err);
        }
      } else {
        // 401 but no refresher or already retried
        onUnauthenticated?.call();
      }
    }

    super.onError(err, handler);
  }
}
