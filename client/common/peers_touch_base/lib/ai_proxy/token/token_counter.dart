class TokenCounter {
  static int countTextTokens(String text) {
    int cjk = 0;
    int ascii = 0;
    for (final codePoint in text.runes) {
      if (_isCJK(codePoint)) {
        cjk += 1;
      } else if (_isAscii(codePoint)) {
        ascii += 1;
      } else {
        ascii += 1;
      }
    }
    final asciiTokens = (ascii + 3) ~/ 4;
    return cjk + asciiTokens;
  }

  static bool _isAscii(int cp) => cp <= 0x7F;

  static bool _isCJK(int cp) {
    if (cp >= 0x3400 && cp <= 0x4DBF) return true;
    if (cp >= 0x4E00 && cp <= 0x9FFF) return true;
    if (cp >= 0xF900 && cp <= 0xFAFF) return true;
    if (cp >= 0x20000 && cp <= 0x2FFFF) return true;
    return false;
  }
}
