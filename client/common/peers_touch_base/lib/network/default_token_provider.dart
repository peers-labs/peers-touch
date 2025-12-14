import '../storage/secure_storage_adapter.dart';
import 'token_provider.dart';

class DefaultTokenProvider implements TokenProvider {
  final SecureStorageAdapter secureStorage;
  DefaultTokenProvider({required this.secureStorage});
  @override
  Future<void> clear() async {
    await secureStorage.remove('token_key');
    await secureStorage.remove('refresh_token_key');
  }

  @override
  Future<String?> readAccessToken() => secureStorage.get('token_key');

  @override
  Future<String?> readRefreshToken() => secureStorage.get('refresh_token_key');

  @override
  Future<void> writeTokens({required String accessToken, String? refreshToken}) async {
    await secureStorage.set('token_key', accessToken);
    if (refreshToken != null && refreshToken.isNotEmpty) {
      await secureStorage.set('refresh_token_key', refreshToken);
    }
  }
}
