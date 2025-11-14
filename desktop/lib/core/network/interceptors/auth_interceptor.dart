import 'package:dio/dio.dart';
import 'package:peers_touch_desktop/core/constants/storage_keys.dart';

class AuthInterceptor extends Interceptor {
  final SecureStorageService secureStorage;

  AuthInterceptor({required this.secureStorage});

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    try {
      final token = await secureStorage.get(StorageKeys.tokenKey);
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    } catch (_) {
      // ignore read errors, proceed without token
    }
    handler.next(options);
  }
}