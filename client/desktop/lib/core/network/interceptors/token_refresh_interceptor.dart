import 'package:dio/dio.dart';

import 'package:peers_touch_desktop/core/constants/storage_keys.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:peers_touch_desktop/core/network/token_refresh_handler.dart';

class TokenRefreshInterceptor extends Interceptor {
  final Dio dio;
  final SecureStorage secureStorage;
  final TokenRefreshHandler refreshHandler;

  TokenRefreshInterceptor({
    required this.dio,
    required this.secureStorage,
    required this.refreshHandler,
  });

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final status = err.response?.statusCode ?? 0;
    final opts = err.requestOptions;
    if (status == 401 && (opts.extra['retryAfterRefresh'] != true)) {
      opts.extra['retryAfterRefresh'] = true;
      try {
        final refreshToken = await secureStorage.get(StorageKeys.refreshTokenKey);
        if (refreshToken == null) {
          return handler.next(err);
        }
        final newPair = await refreshHandler.refresh(refreshToken);
        if (newPair == null) {
          return handler.next(err);
        }
        await secureStorage.set(StorageKeys.tokenKey, newPair.accessToken);
        await secureStorage.set(StorageKeys.refreshTokenKey, newPair.refreshToken);

        // Attach new access token header and retry original request
        opts.headers = Map<String, dynamic>.from(opts.headers);
        opts.headers['Authorization'] = 'Bearer ${newPair.accessToken}';
        final response = await dio.fetch(opts);
        return handler.resolve(response);
      } catch (_) {
        return handler.next(err);
      }
    }
    handler.next(err);
  }
}