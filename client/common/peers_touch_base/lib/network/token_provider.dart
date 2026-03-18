abstract class TokenProvider {
  Future<String?> readAccessToken();
  Future<String?> readRefreshToken();
  Future<String?> readSessionId();
  Future<void> writeTokens({required String accessToken, String? refreshToken, String? sessionId});
  Future<void> clear();
}
