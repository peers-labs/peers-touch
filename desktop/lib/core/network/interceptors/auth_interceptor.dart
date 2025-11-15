import 'package:dio/dio.dart';
import 'package:peers_touch_desktop/core/constants/storage_keys.dart';

class AuthInterceptor extends Interceptor {
  final SecureStorageService secureStorageService;

  AuthInterceptor({required this.secureStorageService});

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    try {
      final token = await secureStorageService.get(StorageServiceKeys.tokenKey);
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    } catch (_) {
      // ignore read errors, proceed without token
    }
    handler.next(options);
  }
}