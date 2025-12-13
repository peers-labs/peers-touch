import 'package:dio/dio.dart';
import 'package:peers_touch_desktop/core/constants/storage_keys.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/token_provider.dart';

class AuthInterceptor extends Interceptor {
  final SecureStorage secureStorage;

  AuthInterceptor({required this.secureStorage});

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    String? token;
    try {
      if (Get.isRegistered<TokenProvider>()) {
        final tp = Get.find<TokenProvider>();
        token = await tp.readAccessToken();
      }
    } catch (_) {}
    if (token == null || token.isEmpty) {
      try {
        token = await secureStorage.get(StorageKeys.tokenKey);
      } catch (_) {}
    }
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }
}
