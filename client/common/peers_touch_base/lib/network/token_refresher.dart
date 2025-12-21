abstract class TokenPair {
  String get accessToken;
  String get refreshToken;
}

class SimpleTokenPair implements TokenPair {
  @override
  final String accessToken;
  @override
  final String refreshToken;

  const SimpleTokenPair({required this.accessToken, required this.refreshToken});
}

abstract class TokenRefresher {
  /// Refresh the token using the given refresh token.
  /// Returns a new [TokenPair] if successful, or null if failed.
  Future<TokenPair?> refresh(String? refreshToken);
}
