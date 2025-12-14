abstract class TokenProvider {
  Future<String?> readAccessToken();
  Future<String?> readRefreshToken();
  Future<void> writeTokens({required String accessToken, String? refreshToken});
  Future<void> clear();
}
