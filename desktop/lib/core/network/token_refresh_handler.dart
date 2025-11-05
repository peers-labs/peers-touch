class TokenPair {
  final String accessToken;
  final String refreshToken;
  const TokenPair({required this.accessToken, required this.refreshToken});
}

abstract class TokenRefreshHandler {
  /// Implement calling your refresh endpoint and return new tokens.
  Future<TokenPair?> refresh(String? refreshToken);
}