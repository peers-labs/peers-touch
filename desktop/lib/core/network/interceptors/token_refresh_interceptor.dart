import 'package:dio/dio.dart';

import 'package:peers_touch_desktop/core/constants/storage_keys.dart';
import 'package:peers_touch_desktop/core/network/token_refresh_handler.dart';

class TokenRefreshInterceptor extends Interceptor {
  final Dio dio;
  final SecureStorageService secureStorageService;
  final TokenRefreshHandler refreshHandler;

  TokenRefreshInterceptor({
    required this.dio,
    required this.secureStorageService,
    required this.refreshHandler,
  });

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final status = err.response?.statusCode ?? 0;
    final opts = err.requestOptions;
    if (status == 401 && (opts.extra['retryAfterRefresh'] != true)) {
      opts.extra['retryAfterRefresh'] = true;
      try {
        final refreshToken = await secureStorageService.get(StorageServiceKeys.refreshTokenKey);
        if (refreshToken == null) {
          return handler.next(err);
        }
        final newPair = await refreshHandler.refresh(refreshToken);
        if (newPair == null) {
          return handler.next(err);
        }
        await secureStorageService.set(StorageServiceKeys.tokenKey, newPair.accessToken);
        await secureStorageService.set(StorageServiceKeys.refreshTokenKey, newPair.refreshToken);

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